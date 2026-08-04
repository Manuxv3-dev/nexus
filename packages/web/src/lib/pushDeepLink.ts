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

/**
 * Panes ciblables par un deep-link push — cf. `notificationKindToPane`
 * (`@nexus/shared`) : un push ne pointe jamais vers `'home'` (filtré par
 * `buildDeepLinkSearch` ci-dessus) ni vers `'chat'`/`'group_home'` (propres à
 * la navigation in-app d'`AppShell`, jamais produits par une notification).
 * Sous-ensemble volontairement strict — partagé par `AppShell` (desktop) et
 * `MobileShell` (mobile, cf. MAN-151) pour éviter que les deux shells
 * dupergent chacun leur propre notion de "pane valide pour un push".
 */
export const PUSH_DEEP_LINK_PANES = ['event', 'poll', 'expense', 'todo'] as const;

export type PushDeepLinkPane = (typeof PUSH_DEEP_LINK_PANES)[number];

function isPushDeepLinkPane(value: string | null): value is PushDeepLinkPane {
  return value !== null && (PUSH_DEEP_LINK_PANES as readonly string[]).includes(value);
}

/** Cible de deep-link push résolue depuis les query params `/app?...`. */
export interface PushDeepLinkTarget {
  groupId: string;
  pane: PushDeepLinkPane;
  sourceId: string | null;
}

/**
 * Lit `?groupId&pane&sourceId` dans la query string passée — posés sur `/app`
 * par `buildDeepLinkUrl`/`buildDeepLinkSearch` ci-dessus, consommés soit au
 * premier montage du shell actif (app fermée, le service worker fait
 * `clients.openWindow`), soit après une navigation déclenchée par
 * `usePushNavigate` (app déjà ouverte, le SW refocus la fenêtre et poste un
 * message `push-navigate` que ce hook traduit en query params sur cette même
 * route).
 *
 * Prend la query string en argument (plutôt que de lire `window.location`)
 * pour que l'appelant puisse la faire venir de l'état du router : sur une
 * navigation search-only, `/app` ne remonte pas, seul le router signale le
 * changement (cf. `searchStr` dans `AppShell`/`MobileShell`).
 *
 * Renvoie `null` si les query params sont absents ou invalides (pane inconnu,
 * groupId manquant) — dans ce cas l'appelant suit son flux normal (pref de
 * landing pour `AppShell`, écran groupes pour `MobileShell`).
 *
 * Partagée par `AppShell` (desktop) et `MobileShell` (mobile, cf. MAN-151) :
 * même logique de lecture/validation, DRY plutôt que deux implémentations
 * parallèles qui auraient pu diverger (c'est exactement ce qui manquait côté
 * mobile avant MAN-151).
 */
export function readPushDeepLinkParams(searchStr: string): PushDeepLinkTarget | null {
  const params = new URLSearchParams(searchStr);
  const groupId = params.get('groupId');
  const pane = params.get('pane');
  if (!groupId || !isPushDeepLinkPane(pane)) return null;
  return { groupId, pane, sourceId: params.get('sourceId') };
}
