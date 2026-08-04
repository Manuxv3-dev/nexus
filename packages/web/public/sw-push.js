// Service worker minimal — notifications Web Push (cf. MAN-142 phase 1 & 2,
// MAN-24 « notifications push PWA »).
//
// Fichier STATIQUE servi tel quel (pas de build/bundler) : du JS vanilla
// compatible service worker (ES2020+). Volontairement minimal : pas de
// Workbox, pas de cache/fetch.
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
