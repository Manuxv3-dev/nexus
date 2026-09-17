// Service worker minimal — notifications Web Push (cf. MAN-142 phase 1 & 2,
// MAN-24 « notifications push PWA »).
//
// Fichier STATIQUE servi tel quel (pas de build/bundler) : du JS vanilla
// compatible service worker (ES2020+). Volontairement minimal : pas de
// Workbox, pas de cache. Le seul `fetch` du fichier est un secours best-effort
// dans `pushsubscriptionchange` (cf. plus bas) — pas d'interception de
// requêtes réseau (pas de `fetch` event listener).
//
// Payload attendu (posé par le backend, cf. packages/backend/src/routes/push) :
//   { title: string, body: string, data: { groupId: string|null, pane: string, sourceId: string|null } }

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const payload = event.data.json();

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data,
    }),
  );
});

/**
 * Construit l'URL de deep-link `/app?...` à partir du payload `data` de la
 * notification. Copie volontaire (et non un import) de la logique de
 * `src/lib/pushDeepLink.ts::buildDeepLinkUrl` : un service worker statique
 * servi sans bundler ne peut pas importer un module TS de l'app. Le risque
 * de divergence est jugé faible — cette logique se limite à une
 * construction de query string, pas de logique métier complexe.
 */
function buildDeepLinkUrlInline(data) {
  if (!data || data.pane === 'home' || !data.groupId) return '/app';

  const params = new URLSearchParams();
  params.set('groupId', data.groupId);
  params.set('pane', data.pane);
  if (data.sourceId) params.set('sourceId', data.sourceId);

  return `/app?${params.toString()}`;
}

/**
 * Convertit une clé VAPID publique base64 URL-safe en `Uint8Array` — copie
 * volontaire de `src/lib/push.ts::urlBase64ToUint8Array` (même raison que
 * `buildDeepLinkUrlInline` ci-dessus : ce fichier statique, servi sans
 * bundler, ne peut importer aucun module TS de l'app).
 */
function urlBase64ToUint8ArrayInline(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * `oldSubscription.options.applicationServerKey` est absent en pratique sur
 * certains navigateurs/déclenchements de `pushsubscriptionchange` (la spec ne
 * le garantit pas partout). Secours best-effort : va chercher la clé VAPID
 * publique au même endpoint que `subscribeToPush` (`src/lib/push.ts`), en
 * relatif — ne fonctionne qu'en build WEB (même origine que l'API, cf.
 * `API_BASE` par défaut dans `lib/api.ts`). En desktop (Tauri), l'API vit sur
 * une origine absolue (`VITE_API_BASE`, injectée au build) que ce fichier
 * statique — non passé par Vite — ne connaît pas : le `fetch` relatif y cible
 * l'origine `tauri://`/`https://tauri.localhost` de la webview elle-même, pas
 * l'API, et échoue. `catch` couvre ce cas : no-op documenté, pas de crash.
 */
async function fetchFallbackApplicationServerKey() {
  try {
    const response = await fetch('/api/v1/push/vapid-public-key');
    if (!response.ok) return null;
    const { publicKey } = await response.json();
    if (!publicKey) return null;
    return urlBase64ToUint8ArrayInline(publicKey);
  } catch (err) {
    console.warn('[sw-push] clé VAPID de secours indisponible (pushsubscriptionchange)', err);
    return null;
  }
}

/**
 * Re-souscrit le navigateur après un `pushsubscriptionchange` — le navigateur
 * (Firefox à l'expiration de l'abonnement, rotation de clé du push service…)
 * a révoqué ou fait roter l'abonnement SANS passer par nos endpoints. Sans ce
 * handler, l'abonnement navigateur reste mort : au montage suivant,
 * `getSubscription()` renvoie `null`, `reconcilePushSubscription()`
 * (`src/lib/push.ts`) no-ope faute de souscription à ré-envoyer, et le toggle
 * Settings passe OFF en silence (cf. ticket e9ad5861 — complément de #111,
 * qui ne couvrait que le nettoyage côté SERVEUR).
 *
 * Le service worker n'a pas de token d'accès pour POSTer `/push/subscribe`
 * (il vit en mémoire côté app, jamais exposé à un SW, cf. `lib/api.ts`) : on
 * se contente de RE-SOUSCRIRE le navigateur. C'est la réconciliation de
 * `reconcilePushSubscription()` — au prochain montage (#111) ou après un
 * `login()`/`register()` (ticket 792fa6d5) — qui enregistrera le nouvel
 * endpoint côté serveur.
 */
async function resubscribe(oldSubscription) {
  const applicationServerKey =
    oldSubscription?.options?.applicationServerKey ?? (await fetchFallbackApplicationServerKey());

  if (!applicationServerKey) {
    console.warn('[sw-push] pushsubscriptionchange sans clé VAPID exploitable, abandon');
    return;
  }

  try {
    await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  } catch (err) {
    console.warn('[sw-push] échec de re-souscription (pushsubscriptionchange)', err);
  }
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe(event.oldSubscription));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = event.notification.data;

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existingClient = allClients[0];

      if (existingClient) {
        // Une fenêtre Nexus est déjà ouverte : on la refocus et on lui laisse
        // le payload brut — c'est l'app (React, via `buildDeepLinkUrl`) qui
        // décide de la navigation, pas le service worker.
        await existingClient.focus();
        existingClient.postMessage({ type: 'push-navigate', target });
        return;
      }

      await clients.openWindow(buildDeepLinkUrlInline(target));
    })(),
  );
});
