/**
 * MobileShell — deep-link push (MAN-151).
 *
 * Fichier séparé de `MobileShell.test.tsx` : même raison qu'`AppShell` (cf.
 * `AppShell.pushDeepLink.test.tsx`) — ce scénario a besoin d'un mock dédié de
 * `EventsDashboard` pour observer les props `groupId`/`openItemId` sans
 * mocker toute la pile de queries qu'il consomme en interne, et d'un vrai
 * router monté sur `/app` (pas un `useNavigate` mocké) pour couvrir le cas
 * « navigation search-only » (`usePushNavigate`, fenêtre déjà ouverte), qui
 * ne remonte pas le composant.
 *
 * Root cause du bug (MAN-151) : en dessous de 768px, `ResponsiveAppShell`
 * (cf. `router.tsx`) rend `MobileShell` au lieu d'`AppShell`. Or
 * `MobileShell` ne lisait aucun query param `/app?groupId&pane&sourceId` (le
 * mécanisme posé côté `AppShell` par MAN-143) et ne passait même pas
 * `groupId` à ses dashboards features — un clic sur une notif push
 * n'amenait donc jamais sur l'item concerné sur mobile, la plateforme cible
 * principale du push.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { groupsRef, eventsDashboardPropsRef } = vi.hoisted(() => ({
  groupsRef: { current: [] as QueriesModule.Group[] },
  eventsDashboardPropsRef: {
    current: null as { groupId?: string; openItemId?: string | null } | null,
  },
}));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: groupsRef.current, isLoading: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => ({ data: [] }),
  };
});

vi.mock('../features/EventsDashboard', () => ({
  EventsDashboard: (props: { groupId?: string; openItemId?: string | null }) => {
    eventsDashboardPropsRef.current = props;
    return null;
  },
}));

import { MobileShell } from './MobileShell';

/**
 * Monte `MobileShell` derrière un vrai router sur `/app`. Renvoie le router
 * pour pouvoir déclencher une navigation search-only depuis le test (cas
 * « fenêtre déjà ouverte »).
 */
function renderShellWithRouter() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app',
    component: MobileShell,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute]),
    history: createBrowserHistory(),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router };
}

/** Navigation search-only vers `/app?...` — ce que fait `usePushNavigate`. */
async function navigateToDeepLink(
  router: ReturnType<typeof renderShellWithRouter>['router'],
  search: Record<string, string>,
) {
  await act(async () => {
    await router.navigate({ to: '/app', search: search as never });
  });
}

const TEST_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  createdAt: new Date().toISOString(),
};

const GROUP_A: QueriesModule.Group = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'La Bande du 11e',
  createdBy: TEST_USER.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

const GROUP_B: QueriesModule.Group = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Les Vieux Potes',
  createdBy: TEST_USER.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'member',
};

describe('MobileShell — deep-link push (MAN-151)', () => {
  beforeEach(() => {
    eventsDashboardPropsRef.current = null;
    groupsRef.current = [GROUP_A];
    useAuth.setState({ user: TEST_USER, initializing: false });
    window.history.pushState({}, '', '/app');
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    window.history.pushState({}, '', '/app');
  });

  it('ouvre l’item cible depuis ?groupId&pane&sourceId au montage puis nettoie l’URL', async () => {
    window.history.pushState({}, '', `/app?groupId=${GROUP_A.id}&pane=event&sourceId=evt-1`);

    renderShellWithRouter();

    // Même mécanisme `pendingOpen` que côté `AppShell` : le dashboard reçoit
    // le groupe et l'item ciblés, prêt à consommer via `onConsumeOpen`.
    await waitFor(() => {
      expect(eventsDashboardPropsRef.current).toMatchObject({
        groupId: GROUP_A.id,
        openItemId: 'evt-1',
      });
    });
    // L'URL est nettoyée pour ne pas rejouer le deep-link à un refresh.
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('ouvre l’item cible quand le shell est DÉJÀ monté (navigation search-only)', async () => {
    // Régression : c'est le chemin `usePushNavigate` (fenêtre déjà ouverte,
    // le SW poste `push-navigate` au lieu d'ouvrir une fenêtre). `/app` étant
    // une route unique, la navigation ne remonte pas `MobileShell` — le shell
    // doit réagir au changement de query string, pas seulement au montage.
    const { router } = renderShellWithRouter();
    await waitFor(() => expect(eventsDashboardPropsRef.current).toBeNull());

    await navigateToDeepLink(router, {
      groupId: GROUP_A.id,
      pane: 'event',
      sourceId: 'evt-42',
    });

    await waitFor(() => {
      expect(eventsDashboardPropsRef.current).toMatchObject({
        groupId: GROUP_A.id,
        openItemId: 'evt-42',
      });
    });
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('ouvre le groupe ciblé même quand ce n’est pas le premier de la liste', async () => {
    // Garde-fou sur l'ordre des effets : l'effet « groupe par défaut »
    // (`groups[0]`) et l'effet deep-link tournent dans le même commit React
    // au montage, et c'est parce que le second est déclaré APRÈS que la cible
    // du deep-link l'emporte. Avec un seul groupe en fixture, l'invariant est
    // trivialement vrai (la cible EST `groups[0]`) : il faut un groupe cible
    // ≠ `groups[0]` pour qu'une inversion d'ordre fasse tomber le test.
    groupsRef.current = [GROUP_A, GROUP_B];
    window.history.pushState({}, '', `/app?groupId=${GROUP_B.id}&pane=event&sourceId=evt-7`);

    renderShellWithRouter();

    await waitFor(() => {
      expect(eventsDashboardPropsRef.current).toMatchObject({
        groupId: GROUP_B.id,
        openItemId: 'evt-7',
      });
    });
  });

  it('ignore des query params sans groupId et suit le flux normal (liste des groupes)', async () => {
    window.history.pushState({}, '', '/app?pane=event');

    renderShellWithRouter();

    await waitFor(() => expect(document.body.textContent).not.toBe(''));
    expect(eventsDashboardPropsRef.current).toBeNull();
    // Query string non reconnue : pas de nettoyage, pas de deep-link.
    expect(window.location.search).toBe('?pane=event');
  });

  it('ignore un groupId auquel le user n’appartient pas (URL forgée / groupe quitté)', async () => {
    // Sans validation, `activeGroup` retomberait sur `groups[0]` et on
    // ouvrirait `evt-1` dans le mauvais groupe.
    const foreignGroupId = '99999999-9999-9999-9999-999999999999';
    window.history.pushState({}, '', `/app?groupId=${foreignGroupId}&pane=event&sourceId=evt-1`);

    renderShellWithRouter();

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(eventsDashboardPropsRef.current).toBeNull();
  });
});
