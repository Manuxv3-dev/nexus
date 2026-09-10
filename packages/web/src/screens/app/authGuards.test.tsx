/**
 * Gardes d'authentification des écrans qui n'en avaient pas (ticket 85a9aa5c).
 *
 * `AppShell` fait deux choses quand `user` tombe : il redirige vers `/login`
 * et il refuse de rendre (`if (!user) return null`). `MobileShell` ne faisait
 * ni l'une ni l'autre — il ne testait que `initializing`. En dessous de 768px,
 * c'est pourtant lui que `ResponsiveAppShell` monte.
 *
 * Conséquence : une session qui expire laissait l'écran authentifié du compte
 * précédent affiché, avec un `?` à la place du nom, et rien ne poussait
 * l'utilisateur vers `/login`.
 *
 * Le pendant côté rendu de `10bc1096` : celui-ci vide le cache au changement
 * d'identité, mais vider un cache ne re-rend pas un écran. Le cache est la
 * source, la garde est l'affichage.
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
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { groupsRef } = vi.hoisted(() => ({
  groupsRef: { current: [] as QueriesModule.Group[] },
}));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: groupsRef.current, isLoading: false, isPending: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => ({ data: [] }),
  };
});

import { GroupMembersScreen } from './GroupMembersScreen';
import { MobileShell } from './MobileShell';

const TEST_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

function renderShell() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app',
    component: MobileShell,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <div>ecran de connexion</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute, loginRoute]),
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

beforeEach(() => {
  window.history.pushState({}, '', '/app');
  groupsRef.current = [];
  useAuth.setState({ user: TEST_USER, initializing: false });
});

afterEach(() => {
  useAuth.setState({ user: null, initializing: true });
});

/**
 * Même harnais que ci-dessus, mais sur la route paramétrée que
 * `GroupMembersScreen` lit via `useParams({ from: ... })` — le chemin doit
 * donc correspondre exactement.
 */
function renderMembersScreen() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const membersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/groups/$groupId/members',
    component: GroupMembersScreen,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <div>ecran de connexion</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([membersRoute, loginRoute]),
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

describe('MobileShell — garde d’authentification', () => {
  it("cesse d'afficher l'écran authentifié quand la session tombe", async () => {
    const { router } = renderShell();
    // Pré-condition : tant que la session tient, le nom est bien à l'écran.
    await waitFor(() => expect(screen.getByText('Manu')).toBeInTheDocument());

    act(() => {
      useAuth.setState({ user: null, initializing: false });
    });

    // Ni le nom, ni les `?` qui le remplaçaient faute de garde — il y en a
    // plusieurs (l'avatar et le libellé), d'où `queryAllByText`.
    await waitFor(() => expect(screen.queryByText('Manu')).not.toBeInTheDocument());
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.queryAllByText('?')).toHaveLength(0);
  });

  it("n'affiche pas l'écran authentifié tant que l'auth n'est pas résolue", () => {
    // Non-régression sur le comportement existant : pendant `initializing`,
    // c'est le loader qui s'affiche, pas la coquille authentifiée — et
    // surtout pas de redirection vers `/login`, qui éjecterait un utilisateur
    // parfaitement connecté au moindre rafraîchissement de page.
    useAuth.setState({ user: null, initializing: true });
    const { router } = renderShell();

    expect(screen.queryByText('Manu')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app');
  });
});

describe('GroupMembersScreen — garde d’authentification', () => {
  // Trouvé en auditant les autres écrans authentifiés, comme le ticket le
  // demandait. Exposition moindre que `MobileShell` — l'écran finit sur un
  // 401 plutôt que d'afficher du contenu périmé — mais même défaut : rien ne
  // renvoyait vers `/login`.
  beforeEach(() => {
    window.history.pushState({}, '', '/groups/22222222-2222-2222-2222-222222222222/members');
  });

  it('renvoie vers /login quand la session tombe', async () => {
    const { router } = renderMembersScreen();
    expect(router.state.location.pathname).toContain('/members');

    act(() => {
      useAuth.setState({ user: null, initializing: false });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it("ne renvoie pas vers /login tant que l'auth n'est pas résolue", () => {
    useAuth.setState({ user: null, initializing: true });
    const { router } = renderMembersScreen();

    expect(router.state.location.pathname).toContain('/members');
  });
});
