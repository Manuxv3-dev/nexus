import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';

/**
 * Flow OAuth Discord pour l'installation du bot dans un guild (cf. plan J3b).
 *
 * Étapes :
 *  1. User authentifié dans Nexus clique "Connecter Discord" dans son groupe
 *  2. Backend appelle `buildInstallUrl({ groupId, userId })` qui génère un
 *     state signé HMAC-SHA256 et renvoie l'URL d'install Discord
 *  3. Le client redirige vers cette URL → Discord montre l'écran d'install
 *  4. User choisit son serveur Discord, autorise les permissions du bot
 *  5. Discord redirige vers `redirect_uri` avec `code`, `state`, `guild_id`
 *  6. Backend appelle `verifyState(state)` puis `exchangeCodeForToken(code)`
 *     (juste pour valider — on n'utilise pas l'access token user, le bot a
 *     déjà rejoint le serveur)
 *  7. Backend crée la session messagerie + publish bridge:control:discord
 *
 * Le state signé empêche un attaquant d'injecter un guildId arbitraire dans
 * le callback : sans la clé HMAC, impossible de forger un state valide.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STATE_NONCE_BYTES = 16;

interface StatePayload {
  groupId: string;
  userId: string;
  ts: number;
  nonce: string;
}

/**
 * Construit l'URL d'install Discord pour un groupe + user donnés.
 *
 * Format de retour : la valeur à laquelle le client doit rediriger pour
 * ouvrir l'écran d'install Discord.
 */
export function buildInstallUrl(input: { groupId: string; userId: string }): string {
  const env = loadEnv();
  const clientId = process.env['DISCORD_CLIENT_ID'];
  const permissions = process.env['DISCORD_BOT_PERMISSIONS'] ?? '274877975552';
  const publicBaseUrl = process.env['PUBLIC_BASE_URL'] ?? 'http://127.0.0.1:3000';

  if (!clientId) {
    throw new AppError('INTERNAL_ERROR', { reason: 'DISCORD_CLIENT_ID missing' });
  }

  const state = signState({
    groupId: input.groupId,
    userId: input.userId,
    ts: Date.now(),
    nonce: randomBytes(STATE_NONCE_BYTES).toString('hex'),
  });

  const redirectUri = `${publicBaseUrl}/api/v1/messaging/discord/oauth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions,
    state,
    redirect_uri: redirectUri,
    response_type: 'code',
  });

  // Suppress unused — env reserved for future use (e.g. logging level)
  void env;

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/**
 * Signe un payload en base64url(json) + "." + hex(hmac).
 * On utilise le `JWT_REFRESH_SECRET` comme clé HMAC pour ne pas avoir
 * à introduire un secret de plus dans l'env (la rotation de clé sur ce
 * sujet est rarissime).
 */
function signState(payload: StatePayload): string {
  const env = loadEnv();
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = createHmac('sha256', env.JWT_REFRESH_SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

/**
 * Vérifie la signature du state et la fraîcheur (< 10 min). Renvoie le
 * payload validé.
 *
 * Throw AUTH_TOKEN_INVALID si signature mismatch, AUTH_TOKEN_EXPIRED si trop vieux.
 */
export function verifyState(state: string): StatePayload {
  const env = loadEnv();
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AppError('AUTH_TOKEN_INVALID', { reason: 'state_format' });
  }
  const [b64, sig] = parts;

  const expectedSig = createHmac('sha256', env.JWT_REFRESH_SECRET).update(b64).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('AUTH_TOKEN_INVALID', { reason: 'state_signature_mismatch' });
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    throw new AppError('AUTH_TOKEN_INVALID', { reason: 'state_payload_parse' });
  }

  if (
    typeof payload.groupId !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.ts !== 'number' ||
    typeof payload.nonce !== 'string'
  ) {
    throw new AppError('AUTH_TOKEN_INVALID', { reason: 'state_payload_shape' });
  }

  if (Date.now() - payload.ts > STATE_TTL_MS) {
    throw new AppError('AUTH_TOKEN_EXPIRED', { reason: 'state_too_old' });
  }

  return payload;
}

/**
 * Échange le `code` OAuth contre un access token via l'endpoint Discord.
 * On valide juste que l'échange réussit (preuve que l'user a légitimement
 * complété le flow). On n'utilise pas l'access token retourné — le bot a
 * déjà rejoint le serveur grâce au scope `bot`.
 *
 * Renvoie le `guild` info récupéré dans le code exchange (Discord renvoie
 * les infos du guild sélectionné dans la réponse).
 */
export async function exchangeCodeForGuildInfo(code: string): Promise<{
  guildId: string;
  guildName: string;
}> {
  const clientId = process.env['DISCORD_CLIENT_ID'];
  const clientSecret = process.env['DISCORD_CLIENT_SECRET'];
  const publicBaseUrl = process.env['PUBLIC_BASE_URL'] ?? 'http://127.0.0.1:3000';

  if (!clientId || !clientSecret) {
    throw new AppError('INTERNAL_ERROR', { reason: 'discord_oauth_credentials_missing' });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${publicBaseUrl}/api/v1/messaging/discord/oauth/callback`,
  });

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError('AUTH_TOKEN_INVALID', {
      reason: 'discord_code_exchange_failed',
      status: res.status,
      body: body.slice(0, 200), // limiter pour ne pas leak en logs
    });
  }

  const data = (await res.json()) as {
    access_token: string;
    guild?: { id: string; name: string };
  };

  if (!data.guild?.id || !data.guild.name) {
    throw new AppError('AUTH_TOKEN_INVALID', {
      reason: 'discord_oauth_no_guild_in_response',
    });
  }

  return { guildId: data.guild.id, guildName: data.guild.name };
}
