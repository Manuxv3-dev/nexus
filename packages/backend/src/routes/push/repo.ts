/**
 * Repository Push — accès Drizzle à la table `push_subscriptions` +
 * envoi effectif des notifications Web Push (cf. MAN-142, phases 1 et 3 de
 * MAN-24 « notifications push PWA »).
 *
 * Garde les routes Fastify minces (validation + auth + appel repo).
 */
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';

import { loadEnv } from '../../core/env.js';
import { logger } from '../../core/logger.js';
import { getDb } from '../../db/client.js';
import { pushSubscriptions } from '../../db/schema/index.js';

export interface SubscribeUserInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Upsert un abonnement push pour `userId`.
 *
 * `endpoint` est UNIQUE en DB (cf. schema) : un re-subscribe sur le même
 * endpoint (même navigateur/device, clés potentiellement renouvelées, ou
 * changement de compte sur ce navigateur) met à jour la ligne existante
 * plutôt que d'en créer une nouvelle. `previewEnabled` n'est jamais réécrit
 * ici — c'est un réglage utilisateur indépendant du cycle de vie de
 * l'abonnement, un re-subscribe ne doit pas le reset à sa valeur par défaut.
 */
export async function subscribeUser(userId: string, input: SubscribeUserInput): Promise<void> {
  const db = getDb();
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    });
}

/**
 * Supprime l'abonnement push `endpoint` s'il appartient à `userId`.
 *
 * Anti-leak (même pattern que `markNotificationRead` dans
 * `routes/notifications/repo.ts`) : si l'endpoint appartient à un autre
 * user, la clause WHERE ne matche aucune ligne — 0 suppression, pas
 * d'erreur. Le caller ne doit pas exposer la distinction "supprimé" vs
 * "pas trouvé/pas à toi" dans la réponse HTTP.
 *
 * Renvoie `true` si une ligne a été supprimée.
 */
export async function unsubscribeUser(userId: string, endpoint: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  return result.length > 0;
}

/**
 * Libellé générique par `kind`, utilisé pour le `body` du push tant que le
 * contenu détaillé (phase 4 de MAN-24) n'est pas branché. Volontairement
 * minimal : pas de deep-link ni de détail métier ici (phase 2 et 4).
 */
const GENERIC_BODY_BY_KIND: Record<string, string> = {
  event_reminder: 'Un événement approche',
  event_rsvp_requested: 'Une réponse est attendue',
  event_rsvp_received: 'Nouvelle réponse à un événement',
  expense_added: 'Nouvelle dépense partagée',
  todo_assigned: 'Une tâche vous a été assignée',
  todo_completed: 'Une tâche a été complétée',
};

/** Construit le payload Web Push (title/body) à partir du `kind` de la notif. */
function buildPushPayload(kind: string): { title: string; body: string } {
  return {
    title: 'Nexus',
    body: GENERIC_BODY_BY_KIND[kind] ?? 'Nouvelle activité',
  };
}

let vapidConfigured = false;

/**
 * Configure `web-push` avec les clés VAPID (une seule fois par process).
 * Renvoie `false` sans rien configurer si les clés sont absentes de l'env
 * (dev/CI sans push configuré) — auquel cas `sendPushToUser` doit no-op.
 */
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = loadEnv();
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logger.warn('sendPushToUser: VAPID keys missing — push notifications disabled');
    return false;
  }
  // Subject "mailto:" requis par la spec Web Push (contact en cas d'abus
  // signalé par un push service). Pas de var d'env dédiée pour l'instant.
  webpush.setVapidDetails('mailto:support@nexusapp.chat', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

export interface SendPushNotifInput {
  kind: string;
  /** Payload JSONB de la notif source — pas encore exploité (phases 2/4). */
  payload: Record<string, unknown>;
}

/**
 * Envoie un push à tous les devices abonnés de `userId`. Best-effort et
 * non-bloquant : appelé depuis le choke point d'insertion des notifs
 * (`insertNotification`/`insertNotificationsBulk`), une erreur d'envoi (un
 * subscription mort, un push service indisponible, ...) est loguée et
 * n'est jamais relancée — un push raté ne doit jamais faire échouer
 * l'écriture de la notif en base.
 *
 * Contenu volontairement générique par `kind` pour cette phase (cf.
 * `buildPushPayload`) — le deep-link (phase 2) et le contenu détaillé
 * (phase 4) viendront enrichir ce payload plus tard. Le cleanup fin des
 * subscriptions mortes (404/410) est également hors scope ici.
 */
export async function sendPushToUser(userId: string, notif: SendPushNotifInput): Promise<void> {
  const db = getDb();
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  if (subs.length === 0) return;

  if (!ensureVapidConfigured()) return;

  const payload = JSON.stringify(buildPushPayload(notif.kind));

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err) {
        logger.warn({ err, userId, endpoint: sub.endpoint }, 'sendPushToUser: send failed');
      }
    }),
  );
}
