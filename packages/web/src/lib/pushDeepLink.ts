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
 * Construit les query params `/app?...` (sans le `/app?` lui-même) à partir
 * du payload push. `null` quand `pane` vaut `'home'` ou que `groupId` est
 * absent — dans ces cas, l'app doit simplement s'ouvrir sur sa dernière
 * position connue, pas sur un item précis.
 *
 * Extrait de `buildDeepLinkUrl` pour être réutilisable par `usePushNavigate`
 * (MAN-143 Phase 2 Task 4), qui a besoin d'un objet `search` — pas d'une URL
 * en chaîne — pour l'API `navigate({ to, search })` de TanStack Router.
 */
export function buildDeepLinkSearch(data: PushDeepLinkData): Record<string, string> | null {
  if (data.pane === 'home' || !data.groupId) return null;

  const search: Record<string, string> = { groupId: data.groupId, pane: data.pane };
  if (data.sourceId) search.sourceId = data.sourceId;
  return search;
}

/**
 * Construit l'URL de deep-link `/app?...` à ouvrir/refocus au clic sur une
 * notification push. Retombe sur `/app` nu (pas de query string) quand
 * `pane` vaut `'home'` ou que `groupId` est absent — dans ces cas, l'app doit
 * simplement s'ouvrir sur sa dernière position connue, pas sur un item précis.
 */
export function buildDeepLinkUrl(data: PushDeepLinkData): string {
  const search = buildDeepLinkSearch(data);
  if (!search) return '/app';

  const params = new URLSearchParams(search);
  return `/app?${params.toString()}`;
}
