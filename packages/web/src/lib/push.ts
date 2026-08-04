/**
 * Helpers Web Push — détection de capacité + (dés)abonnement navigateur (cf.
 * MAN-142 phase 1, sous-ticket MAN-24 « notifications push PWA »).
 *
 * Même contrat que `tauri.ts` :
 *  - `isPushSupported()` détecte le support (Service Worker + Push API)
 *  - En environnement non supporté (navigateur trop ancien, iframe
 *    sandboxée, tests jsdom sans mock…), les helpers d'action no-opent
 *    silencieusement plutôt que de jeter
 *
 * Contrat backend (cf. `packages/backend/src/routes/push`) :
 *   GET    /api/v1/push/vapid-public-key → { publicKey: string } (base64 URL-safe)
 *   POST   /api/v1/push/subscribe        ← { endpoint, keys: { p256dh, auth } }
 *   DELETE /api/v1/push/subscribe        ← { endpoint }
 *
 * Le service worker qui reçoit les push est `public/sw-push.js` (statique,
 * pas de build) — enregistré ici via `navigator.serviceWorker.register`.
 */
import { z } from 'zod';

import { api } from './api';

/** Chemin du service worker push, servi tel quel depuis `public/`. */
const SW_PATH = '/sw-push.js';

const VapidPublicKeyReply = z.object({ publicKey: z.string().min(1) });

/**
 * Détecte le support Web Push du navigateur courant (Service Worker + Push
 * API). Les helpers d'action ci-dessous no-opent si `false`.
 */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  );
}

export type PushSubscriptionStatus = 'subscribed' | 'not-subscribed' | 'unsupported';

/**
 * Enregistre (ou récupère) le service worker push puis renvoie l'état
 * d'abonnement courant du navigateur. `'unsupported'` si le navigateur ne
 * supporte pas Web Push — ne fait alors aucun appel réseau ni registration.
 */
export async function getPushSubscriptionStatus(): Promise<PushSubscriptionStatus> {
  if (!isPushSupported()) return 'unsupported';
  const registration = await navigator.serviceWorker.register(SW_PATH);
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? 'subscribed' : 'not-subscribed';
}

/**
 * Convertit une clé VAPID publique base64 URL-safe (format renvoyé par le
 * backend) en `Uint8Array`, le format attendu par
 * `PushManager.subscribe({ applicationServerKey })`.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  // Type explicite `Uint8Array<ArrayBuffer>` (plutôt que `Uint8Array` nu) :
  // avec `lib: ES2022`, TS 5.7+ défaulte le paramètre générique de
  // `Uint8Array` à `ArrayBufferLike`, que `BufferSource`
  // (attendu par `applicationServerKey`) refuse (il exige `ArrayBuffer`).
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Abonne le navigateur courant aux notifications push et enregistre
 * l'abonnement côté backend. No-op silencieux si le navigateur ne supporte
 * pas Web Push (cf. `isPushSupported`).
 */
export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.register(SW_PATH);
  const { publicKey } = await api({
    method: 'GET',
    path: '/push/vapid-public-key',
    reply: VapidPublicKeyReply,
  });

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const { keys } = subscription.toJSON();
  await api({
    method: 'POST',
    path: '/push/subscribe',
    body: {
      endpoint: subscription.endpoint,
      keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' },
    },
  });
}

/**
 * Désabonne le navigateur courant des notifications push.
 *
 * Ordre important : on désenregistre d'abord côté backend, et seulement en
 * cas de succès on désabonne côté navigateur (`sub.unsubscribe()`) — pour ne
 * jamais désynchroniser client/serveur si le DELETE échoue (le navigateur
 * resterait abonné, mais le backend le saurait toujours et pourrait
 * réessayer / l'utilisateur pourrait reréessayer).
 *
 * No-op si aucun abonnement actif, ou si le navigateur ne supporte pas Web
 * Push.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.register(SW_PATH);
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await api({
    method: 'DELETE',
    path: '/push/subscribe',
    body: { endpoint: subscription.endpoint },
  });

  await subscription.unsubscribe();
}
