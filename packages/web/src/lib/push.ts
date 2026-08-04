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
 *   POST   /api/v1/push/subscribe        ← { endpoint, keys: { p256dh, auth },
 *                                           previewEnabled? } (posé à la création seulement)
 *   PATCH  /api/v1/push/subscribe        ← { endpoint, previewEnabled } (anti-leak,
 *                                           toujours `{ ok: true }`)
 *   DELETE /api/v1/push/subscribe        ← { endpoint }
 *
 * Le service worker qui reçoit les push est `public/sw-push.js` (statique,
 * pas de build) — enregistré ici via `navigator.serviceWorker.register`.
 */
import { z } from 'zod';

import { api } from './api';

/** Chemin du service worker push, servi tel quel depuis `public/`. */
const SW_PATH = '/sw-push.js';

/**
 * Préférence "Aperçu" de CET appareil, miroir local de `previewEnabled` de la
 * souscription push (cf. MAN-145 phase 4).
 *
 * Stockée en localStorage — même choix que `nx:lastGroup` / `nx:bladeWidth`
 * (AppShell) : la préférence est intrinsèquement device-dependent (une
 * souscription = un navigateur) et le backend n'expose aucune lecture de
 * `previewEnabled`. Sans ce miroir, le toggle Settings repartirait à ON à
 * chaque rechargement pendant que le serveur enverrait du contenu masqué —
 * et un réglage fait AVANT le premier abonnement serait purement perdu.
 */
const LS_PUSH_PREVIEW = 'nx:pushPreview';

/**
 * Lit la préférence "Aperçu" de cet appareil. `true` par défaut (aligné sur le
 * défaut DB `push_subscriptions.preview_enabled`) — y compris si localStorage
 * est indisponible (Safari private, iframe sandboxée).
 */
export function readPushPreview(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(LS_PUSH_PREVIEW) !== 'off';
  } catch {
    return true;
  }
}

function writePushPreview(previewEnabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_PUSH_PREVIEW, previewEnabled ? 'on' : 'off');
  } catch {
    // localStorage indisponible → la préférence ne survivra pas au reload,
    // mais la souscription serveur, elle, a bien été mise à jour.
  }
}

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
 *
 * Atomique du point de vue de l'appelant : si l'enregistrement backend
 * échoue, l'abonnement navigateur créé juste avant est annulé avant de
 * propager l'erreur (cf. commentaire inline).
 *
 * Envoie la préférence "Aperçu" de cet appareil (`readPushPreview`) avec la
 * souscription : l'utilisateur a pu régler « Aperçu » AVANT d'activer le push
 * (ou avoir désactivé puis réactivé le push, ce qui supprime puis recrée la
 * ligne). Sans ça, la nouvelle ligne repartirait au défaut `true` et le
 * premier push s'afficherait en clair contre son choix explicite.
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
  try {
    await api({
      method: 'POST',
      path: '/push/subscribe',
      body: {
        endpoint: subscription.endpoint,
        keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' },
        previewEnabled: readPushPreview(),
      },
    });
  } catch (err) {
    // Le navigateur est DÉJÀ abonné à ce stade. Si le backend n'a pas
    // enregistré la souscription, on annule côté navigateur avant de propager
    // l'erreur : sinon `getPushSubscriptionStatus()` (qui lit l'état NAVIGATEUR)
    // renverrait 'subscribed' et le toggle Settings afficherait ON alors qu'aucun
    // push ne peut arriver — un mensonge silencieux, pire que l'échec lui-même.
    await subscription.unsubscribe().catch(() => undefined);
    throw err;
  }
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

/**
 * Met à jour la préférence "Aperçu du message" (contenu visible ou masqué
 * dans la notification) pour l'abonnement push de CET appareil — préférence
 * par appareil, pas par compte (cf. MAN-145 phase 4, sous-ticket MAN-24).
 *
 * Deux écritures, dans cet ordre :
 *  1. `PATCH /push/subscribe` si cet appareil a un abonnement actif (c'est
 *     lui qui décide du contenu réellement envoyé) ;
 *  2. le miroir local (`LS_PUSH_PREVIEW`), seulement si l'étape 1 a réussi ou
 *     n'avait pas lieu d'être — pour ne jamais afficher un toggle qui
 *     contredit ce que le serveur enverra.
 *
 * Sans abonnement (push pas encore activé, ou navigateur sans Web Push), il
 * n'y a rien à patcher : la préférence est mémorisée localement et sera
 * envoyée par le prochain `subscribeToPush()`. Le choix n'est donc jamais
 * perdu. L'erreur d'un PATCH échoué est propagée (l'appelant remet son toggle
 * dans l'état serveur).
 */
export async function setPushPreview(previewEnabled: boolean): Promise<void> {
  if (isPushSupported()) {
    const registration = await navigator.serviceWorker.register(SW_PATH);
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await api({
        method: 'PATCH',
        path: '/push/subscribe',
        body: { endpoint: subscription.endpoint, previewEnabled },
      });
    }
  }

  writePushPreview(previewEnabled);
}
