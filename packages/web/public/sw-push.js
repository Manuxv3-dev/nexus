// Service worker minimal — notifications Web Push (cf. MAN-142 phase 1,
// MAN-24 « notifications push PWA »).
//
// Fichier STATIQUE servi tel quel (pas de build/bundler) : du JS vanilla
// compatible service worker (ES2020+). Volontairement minimal : pas de
// Workbox, pas de cache/fetch, pas de `notificationclick` — une phase
// ultérieure gèrera le clic sur la notif (deep-link vers l'event/poll/etc.).
//
// Payload attendu (posé par le backend, cf. packages/backend/src/routes/push) :
//   { title: string, body: string, data?: unknown }
// `data` est optionnel et pourra être enrichi par des phases ultérieures
// (ex: url de deep-link) sans que ce service worker n'ait à changer.

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
