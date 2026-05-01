/**
 * Bridge RPC — pattern requête/réponse entre le serveur HTTP et les workers
 * bridges via Redis pub/sub.
 *
 * Pourquoi ?
 * ----------
 * L'ADR-009 (architecture bridges server-side) impose qu'**un seul process
 * détienne le client gateway** d'un provider donné (Discord, WhatsApp,
 * Messenger). Discord refuse explicitement deux clients simultanés avec le
 * même token — donc le serveur HTTP ne peut pas avoir son propre client.
 *
 * Conséquence : les opérations qui nécessitent un appel live au provider
 * (fetchHistory, sendMessage) ne peuvent **pas** être faites côté HTTP. Il
 * faut les **déléguer** au worker.
 *
 * Pattern
 * -------
 * 1. HTTP `requestRpc(provider, op, args, timeoutMs)` :
 *    a. Génère un `requestId` nanoid
 *    b. Subscribe au topic réponse `bridge:rpc:<provider>:reply:<requestId>`
 *    c. Publish une requête sur `bridge:rpc:<provider>:request`
 *    d. Attend la réponse OU timeout
 *    e. Unsubscribe + résoud la promesse
 *
 * 2. Worker `serveRpc(provider, handlers)` :
 *    a. Subscribe au topic `bridge:rpc:<provider>:request`
 *    b. Pour chaque requête : valide, dispatch vers `handlers[op]`
 *    c. Publish la réponse sur le topic dédié au requestId
 *    d. Si le handler throw : publish une erreur typée
 *
 * Garanties
 * ---------
 * - Validation Zod systématique (anti-injection, anti-fuites de schéma)
 * - Timeout côté HTTP : aucune requête ne reste pendante indéfiniment
 * - Channel de réponse dédié au requestId : pas de cross-talk même si N
 *   workers répondent (le lock distribué garantit déjà 1 worker par provider,
 *   mais c'est une ceinture+bretelles)
 * - Erreur typée propagée : le worker peut renvoyer un AppError (RESOURCE_NOT_FOUND,
 *   VALIDATION_ERROR, etc.) que le HTTP rejouera à l'appelant
 *
 * Évolution
 * ---------
 * Ce module est volontairement **typé fort** côté TypeScript via les
 * interfaces `BridgeRpcOps`. À chaque nouvelle op, ajouter une entrée dans
 * `BridgeRpcOps` + une implémentation côté worker. Les types T sont vérifiés
 * statiquement, le payload est validé runtime côté worker.
 */
import Redis from 'ioredis';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { loadEnv } from '../../core/env.js';
import { AppError, ERROR_CODES, type ErrorCode } from '../../core/errors.js';
import type { ProviderType } from '@nexus/shared';

// ─────────────────────────── Types des opérations ────────────────────────

/**
 * Map des opérations RPC supportées. Chaque op a un schéma `args` et un
 * schéma `result` validés runtime côté worker (à l'arrivée d'une requête)
 * et côté HTTP (à la réception d'une réponse).
 */
export const RpcOps = {
  fetchHistory: {
    args: z.object({
      sessionId: z.string().uuid(),
      channelExternalId: z.string(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    result: z.object({
      // On reste générique : le worker renvoie des objets ProviderMessage
      // déjà sérialisables (cf. mapDiscordMessage).
      messages: z.array(z.unknown()),
      nextCursor: z.string().nullable(),
    }),
  },
  sendMessage: {
    args: z.object({
      sessionId: z.string().uuid(),
      channelExternalId: z.string(),
      content: z.string().min(1).max(4000),
      replyToExternalId: z.string().optional(),
    }),
    result: z.object({
      externalMessageId: z.string(),
      sentAt: z.string(),
    }),
  },
} as const;

export type RpcOpName = keyof typeof RpcOps;
type ArgsOf<O extends RpcOpName> = z.infer<(typeof RpcOps)[O]['args']>;
type ResultOf<O extends RpcOpName> = z.infer<(typeof RpcOps)[O]['result']>;

// ─────────────────────────── Topics ───────────────────────────────────────

function requestTopic(provider: ProviderType): string {
  return `bridge:rpc:${provider}:request`;
}
function replyTopic(provider: ProviderType, requestId: string): string {
  return `bridge:rpc:${provider}:reply:${requestId}`;
}

// ─────────────────────────── Wire format ──────────────────────────────────

const RpcRequestEnvelope = z.object({
  requestId: z.string().min(8),
  op: z.string(),
  args: z.unknown(),
});

const RpcResponseEnvelope = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string().optional(),
      details: z.unknown().optional(),
    }),
  }),
]);

// ─────────────────────────── Côté HTTP : requester ────────────────────────

let httpPublisher: Redis | undefined;
function getHttpPublisher(): Redis {
  httpPublisher ??= new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  return httpPublisher;
}

/**
 * Envoie une requête RPC au worker du provider. Résout avec le résultat
 * typé ou rejette avec une `AppError` :
 *   - `RPC_TIMEOUT` si le worker ne répond pas dans `timeoutMs`
 *   - L'erreur typée propagée par le worker (cf. RpcResponseEnvelope.error)
 */
export async function requestRpc<O extends RpcOpName>(
  provider: ProviderType,
  op: O,
  args: ArgsOf<O>,
  timeoutMs = 5000,
): Promise<ResultOf<O>> {
  // Valide les args avant publication.
  const argsSchema = RpcOps[op].args as z.ZodTypeAny;
  const parsedArgs: unknown = argsSchema.parse(args);

  const requestId = nanoid(16);
  const topic = replyTopic(provider, requestId);

  // Pour Redis pub/sub, le subscriber doit être un client séparé du
  // publisher. On en crée un dédié à cette requête (closed après réponse
  // ou timeout — coût acceptable pour des appels rares comme fetchHistory).
  const sub = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  try {
    await sub.subscribe(topic);

    const responsePromise = new Promise<ResultOf<O>>((resolve, reject) => {
      sub.on('message', (_channel, message) => {
        try {
          const raw = JSON.parse(message) as unknown;
          const parsed = RpcResponseEnvelope.parse(raw);
          if (!parsed.ok) {
            // Le code d'erreur vient du worker via Redis. On vérifie qu'il
            // fait partie des ErrorCode connus côté HTTP. Si le worker en
            // envoie un inconnu, on tombe en INTERNAL_ERROR proprement
            // (cf. errors.ts).
            const rawCode = parsed.error.code;
            const code: ErrorCode =
              rawCode in ERROR_CODES ? (rawCode as ErrorCode) : 'INTERNAL_ERROR';
            reject(new AppError(code, parsed.error.details ?? {}));
            return;
          }
          const resultSchema = RpcOps[op].result as z.ZodTypeAny;
          const result = resultSchema.parse(parsed.result) as ResultOf<O>;
          resolve(result);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      // Timeout
      setTimeout(() => {
        reject(
          new AppError('RPC_TIMEOUT', {
            provider,
            op,
            timeoutMs,
          }),
        );
      }, timeoutMs).unref?.();
    });

    // Publish la requête après être abonné, pour ne rater aucune réponse
    // si le worker répond très vite.
    await getHttpPublisher().publish(
      requestTopic(provider),
      JSON.stringify({ requestId, op, args: parsedArgs }),
    );

    return await responsePromise;
  } finally {
    try {
      await sub.unsubscribe(topic);
    } catch {
      /* noop */
    }
    sub.disconnect();
  }
}

// ─────────────────────────── Côté worker : responder ──────────────────────

/**
 * Map des handlers fournis au worker. Chaque handler reçoit les `args`
 * déjà validés (typés ArgsOf<O>) et doit renvoyer un `ResultOf<O>`. Si le
 * handler throw une `AppError`, son code est propagé tel quel à l'appelant
 * HTTP. Toute autre erreur devient `INTERNAL_ERROR`.
 */
export type RpcHandlers = {
  [O in RpcOpName]?: (args: ArgsOf<O>) => Promise<ResultOf<O>>;
};

const workerSubs = new Map<ProviderType, Redis>();

/**
 * Démarre le serveur RPC côté worker. À appeler une seule fois au boot.
 * Throw si déjà actif pour ce provider.
 */
export async function serveRpc(
  provider: ProviderType,
  handlers: RpcHandlers,
): Promise<void> {
  if (workerSubs.has(provider)) {
    throw new AppError('INTERNAL_ERROR', { reason: 'rpc_already_serving' });
  }
  const sub = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  workerSubs.set(provider, sub);

  await sub.subscribe(requestTopic(provider));

  // Le worker doit aussi pouvoir publier la réponse sur le topic dédié.
  const pub = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });

  sub.on('message', (_channel, message) => {
    void handleRequest(message, provider, handlers, pub);
  });
}

async function handleRequest(
  message: string,
  provider: ProviderType,
  handlers: RpcHandlers,
  pub: Redis,
): Promise<void> {
  let requestId: string | undefined;
  try {
    const raw = JSON.parse(message) as unknown;
    const envelope = RpcRequestEnvelope.parse(raw);
    requestId = envelope.requestId;

    const op = envelope.op as RpcOpName;
    const handler = handlers[op];
    if (!handler) {
      throw new AppError('VALIDATION_ERROR', { reason: 'unknown_rpc_op', op });
    }

    const argsSchema = RpcOps[op].args as z.ZodTypeAny;
    const args = argsSchema.parse(envelope.args) as ArgsOf<typeof op>;
    // Cast nécessaire : TS ne peut pas savoir que `op` est concret.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (handler as any)(args);

    await pub.publish(
      replyTopic(provider, requestId),
      JSON.stringify({ ok: true, result }),
    );
  } catch (err) {
    const reqId = requestId;
    if (!reqId) {
      // Impossible de répondre sans requestId — on log seulement.
      // eslint-disable-next-line no-console
      console.error('[rpc] received malformed request', err);
      return;
    }
    const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
    const errMsg = err instanceof Error ? err.message : String(err);
    const details =
      err instanceof AppError ? (err as { details?: unknown }).details : undefined;
    await pub.publish(
      replyTopic(provider, reqId),
      JSON.stringify({
        ok: false,
        error: { code, message: errMsg, details: details ?? {} },
      }),
    );
  }
}

/**
 * Helper pour les tests / shutdown propre côté worker.
 */
export async function stopRpc(provider: ProviderType): Promise<void> {
  const sub = workerSubs.get(provider);
  if (!sub) return;
  await sub.unsubscribe();
  sub.disconnect();
  workerSubs.delete(provider);
}
