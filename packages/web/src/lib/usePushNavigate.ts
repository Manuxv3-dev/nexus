/**
 * Écoute les messages `push-navigate` postés par le service worker
 * (`public/sw-push.js`) au clic sur une notification push quand une fenêtre
 * Nexus est déjà ouverte (le SW fait `client.focus()` puis
 * `client.postMessage({ type: 'push-navigate', target })` — cf.
 * `notificationclick` dans `sw-push.js`).
 *
 * Réutilise le même mécanisme que le deep-link « app fermée » (query params
 * `?groupId&pane&sourceId` sur `/app`, consommés au montage par `AppShell`
 * via `readPushDeepLinkParams`, cf. `screens/app/AppShell.tsx`) plutôt que de
 * manipuler l'état interne du shell directement : ce hook est monté au
 * niveau du Router (`RootComponent`, cf. `router.tsx`), donc actif même
 * quand `AppShell` n'est pas monté (l'utilisateur peut être sur `/settings`
 * ou une page publique au moment du clic). Naviguer vers `/app?...` monte
 * (ou re-render, si déjà sur `/app`) `AppShell`, dont l'effet de lecture des
 * query params fait le reste — un seul endroit qui sait traduire
 * groupId/pane/sourceId en `pendingOpen`.
 *
 * `buildDeepLinkSearch` (cf. `lib/pushDeepLink.ts`) centralise la logique de
 * fallback (pane `'home'` ou `groupId` absent → pas de query string) pour
 * rester en phase avec `buildDeepLinkUrl`, utilisée par `sw-push.js` pour le
 * cas « app fermée ».
 */
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { buildDeepLinkSearch, type PushDeepLinkData } from './pushDeepLink';

interface PushNavigateMessage {
  type: 'push-navigate';
  target: PushDeepLinkData;
}

/**
 * Garde de type sur `MessageEvent.data` : le service worker peut à l'avenir
 * émettre d'autres types de messages (`type` différent de `'push-navigate'`)
 * — tout ce qui ne matche pas la forme attendue est ignoré silencieusement.
 */
function isPushNavigateMessage(data: unknown): data is PushNavigateMessage {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as { type?: unknown; target?: unknown };
  return (
    candidate.type === 'push-navigate' && !!candidate.target && typeof candidate.target === 'object'
  );
}

export function usePushNavigate(): void {
  const navigate = useNavigate();

  useEffect(() => {
    // Pas de service worker (navigateur trop ancien, contexte non
    // sécurisé) : rien à écouter, no-op — même garde que `lib/push.ts`.
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // Référence capturée ici (pas relue au cleanup) : robuste si le global
    // change entre le mount et l'unmount.
    const sw = navigator.serviceWorker;

    const handler = (event: MessageEvent) => {
      if (!isPushNavigateMessage(event.data)) return;
      const search = buildDeepLinkSearch(event.data.target);
      if (!search) {
        void navigate({ to: '/app' });
        return;
      }
      // `search` n'est pas typé par un `validateSearch` sur la route `/app`
      // (cf. `router.tsx`) — même contournement que `InviteRedirectScreen`
      // (`search: { invite: slug } as never`).
      void navigate({ to: '/app', search: search as never });
    };

    sw.addEventListener('message', handler);
    return () => sw.removeEventListener('message', handler);
  }, [navigate]);
}
