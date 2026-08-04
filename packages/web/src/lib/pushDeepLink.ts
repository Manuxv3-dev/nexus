/**
 * Construction du deep-link vers `/app` à partir du payload `data` d'une
 * notification push (cf. MAN-142 phase 2, sous-ticket MAN-24).
 *
 * `/app` est la SEULE route du shell principal (cf. `router.tsx`) — panes
 * (event/poll/expense/todo) et groupe actif sont pilotés par état interne du
 * composant `AppShell` (`activeGroupId`, `pane`, `pendingOpen`), pas par
 * l'URL (cf. `persistLastLocation` / `localStorage['nx:lastGroup']` dans
 * `AppShell.tsx`). Cette fonction ne fait donc que poser groupId/pane/sourceId
 * en query params sur `/app` — c'est à `AppShell` de les lire au montage pour
 * se positionner (phase ultérieure, cf. ticket).
 *
 * Le service worker (`public/sw-push.js`, fichier statique sans bundler) ne
 * peut pas importer ce module : il recopie la même logique en JS vanilla pour
 * le cas « aucune fenêtre ouverte » (`clients.openWindow`). Le risque de
 * divergence est jugé faible car cette logique se limite à une construction
 * de query string.
 */

export interface PushDeepLinkData {
  groupId: string | null;
  pane: string;
  sourceId: string | null;
}

/**
 * Construit l'URL de deep-link `/app?...` à ouvrir/refocus au clic sur une
 * notification push. Retombe sur `/app` nu (pas de query string) quand
 * `pane` vaut `'home'` ou que `groupId` est absent — dans ces cas, l'app doit
 * simplement s'ouvrir sur sa dernière position connue, pas sur un item précis.
 */
export function buildDeepLinkUrl(data: PushDeepLinkData): string {
  if (data.pane === 'home' || !data.groupId) return '/app';

  const params = new URLSearchParams();
  params.set('groupId', data.groupId);
  params.set('pane', data.pane);
  if (data.sourceId) params.set('sourceId', data.sourceId);

  return `/app?${params.toString()}`;
}
