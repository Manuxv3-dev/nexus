/**
 * AppShell — deep-link push (MAN-143 Phase 2 Task 4).
 *
 * Fichier séparé de `AppShell.test.tsx` : ce scénario a besoin d'un mock
 * dédié de `EventsDashboard` (pour observer les props `groupId`/`openItemId`
 * sans avoir à mocker toute la pile de queries qu'il consomme en interne —
 * `useEvent`, `useGroupMembers`, etc.), ce qui rendrait le fichier de tests
 * partagé plus difficile à suivre pour les autres suites.
 *
 * Contrairement aux autres suites du shell, on monte ici un **vrai router**
 * (routeTree minimal `/app` + `createBrowserHistory`) au lieu de mocker
 * `useNavigate`. C'est indispensable : le cas « une fenêtre est déjà
 * ouverte » (`usePushNavigate` → `navigate({ to: '/app', search })`) est une
 * navigation *search-only*, qui ne remonte pas le composant. Avec un router
 * mocké, ce chemin est structurellement intestable — et c'est justement
 * celui qui régressait.
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
    useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useHomeFeed: () => ({ data: undefined, isLoading: false, isError: false }),
    useNotifications: () => ({ data: undefined, isLoading: false }),
    useMarkNotificationRead: () => ({ mutate: vi.fn() }),
    useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
    useClearAllNotifications: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock('../features/EventsDashboard', () => ({
  EventsDashboard: (props: { groupId?: string; openItemId?: string | null }) => {
    eventsDashboardPropsRef.current = props;
    return null;
  },
}));

import { AppShell } from './AppShell';

/**
 * Monte `AppShell` derrière un vrai router sur `/app`. Renvoie le router
 * pour pouvoir déclencher une navigation search-only depuis le test (cas
 * « fenêtre déjà ouverte »).
 */
function renderShellWithRouter() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app',
    component: AppShell,
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

describe('AppShell — deep-link push (MAN-143 Phase 2 Task 4)', () => {
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

    // Même mécanisme `pendingOpen` que le clic sur une notif in-app
    // (NotificationsBell/HomeDashboard) : le dashboard reçoit le groupe et
    // l'item ciblés, prêt à consommer via `onConsumeOpen`.
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
    // une route unique, la navigation ne remonte pas `AppShell` — le shell
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

  it('ignore des query params sans groupId et suit le flux normal (pref landing)', async () => {
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
