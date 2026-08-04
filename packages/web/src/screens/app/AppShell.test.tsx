/**
 * AppShell — tests du shell principal (MAN-111 Phase 2 : habillage & entrée
 * du shell/nav).
 *
 * On mocke `@tanstack/react-router` (pas de RouterProvider réel nécessaire
 * pour tester le shell en isolation) et `@/lib/queries` (pas d'appel réseau
 * réel en test — cf. AGENTS/CLAUDE.md sur les tests unitaires @nexus/web).
 * `useAuth` est un store zustand : on le pilote directement via `setState`,
 * pas besoin de mock de module.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { navigateMock, groupsRef, notificationsRef } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  // Piloté par test : `useGroups` lit ce ref, ce qui permet de rendre le
  // shell avec plusieurs groupes et de tester un vrai switch (cf. test
  // « ne rejoue pas l'animation »).
  groupsRef: { current: [] as QueriesModule.Group[] },
  // Idem pour la cloche : `undefined` par défaut (panel vide), piloté par le
  // test qui vérifie la navigation au clic sur une notif.
  notificationsRef: {
    current: undefined as { notifications: unknown[]; unreadCount: number } | undefined,
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    // `AppShell` lit la query string via `useRouterState` (deep-link push) ;
    // ce hook exige un RouterProvider réel, que cette suite ne monte pas.
    // Le deep-link a sa propre suite avec un vrai router
    // (`AppShell.pushDeepLink.test.tsx`) : ici, query string vide.
    useRouterState: () => '',
  };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: groupsRef.current, isLoading: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => ({ data: [] }),
    useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useHomeFeed: () => ({ data: undefined, isLoading: false, isError: false }),
    useNotifications: () => ({ data: notificationsRef.current, isLoading: false }),
    useMarkNotificationRead: () => ({ mutate: vi.fn() }),
    useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
    useClearAllNotifications: () => ({ mutate: vi.fn(), isPending: false }),
    // Rendus par `GroupHomeDashboard` (pane ouvert par un clic sur une pill
    // de groupe) : mockés pour que le switch de groupe reste hermétique.
    useEvents: () => ({ data: [], isLoading: false }),
    usePolls: () => ({ data: [], isLoading: false }),
    useExpenses: () => ({ data: [], isLoading: false }),
    useTodoLists: () => ({ data: [], isLoading: false }),
    useActivityFeed: () => ({ data: [], isLoading: false, isError: false }),
  };
});

import { AppShell } from './AppShell';

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>,
  );
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
  ...GROUP_A,
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Les Voisins',
};

describe('AppShell', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    groupsRef.current = [];
    notificationsRef.current = undefined;
    useAuth.setState({ user: TEST_USER, initializing: false });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  describe('animation d’entrée (MAN-111 Task 1)', () => {
    it('porte les classes tailwindcss-animate sur le conteneur racine au montage', () => {
      const { container } = renderShell();
      const root = container.firstElementChild as HTMLElement;

      expect(root.className).toMatch(/\banimate-in\b/);
      expect(root.className).toMatch(/\bfade-in\b/);
      expect(root.className).toMatch(/\bzoom-in-/);
    });

    it('ne rejoue pas l’animation lors d’un switch de groupe (le shell n’est pas démonté)', async () => {
      const user = userEvent.setup();
      groupsRef.current = [GROUP_A, GROUP_B];
      const { container } = renderShell();

      const root = container.firstElementChild as HTMLElement;
      const classesBefore = root.className;
      expect(screen.getAllByText(GROUP_A.name).length).toBeGreaterThan(0);

      await user.click(screen.getByTitle(GROUP_B.name));

      // Le switch a bien eu lieu (le titre du groupe actif a changé)…
      expect(await screen.findAllByText(GROUP_B.name)).not.toHaveLength(0);
      // …et le shell n'a pas été démonté/remonté au passage : même nœud DOM,
      // mêmes classes → l'animation d'entrée ne rejoue pas. C'est le piège
      // identifié dans MAN-111 (une classe d'animation pilotée par un state
      // ou un `key` dépendant du groupe la rejouerait à chaque switch).
      expect(container.firstElementChild).toBe(root);
      expect(root.className).toBe(classesBefore);
    });

    it('ne rejoue pas l’animation lors d’un re-render sans démontage', () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { container, rerender } = render(
        <QueryClientProvider client={qc}>
          <AppShell />
        </QueryClientProvider>,
      );
      const rootBefore = container.firstElementChild;
      const classesBefore = (rootBefore as HTMLElement).className;

      // Un re-render (ex: parent qui re-render suite à un changement d'état
      // ailleurs dans l'app) ne doit ni démonter/remonter le shell, ni faire
      // varier les classes d'entrée : elles sont statiques (posées une seule
      // fois dans le JSX, pas pilotées par un state qui pourrait être reset).
      rerender(
        <QueryClientProvider client={qc}>
          <AppShell />
        </QueryClientProvider>,
      );

      const rootAfter = container.firstElementChild;
      expect(rootAfter).toBe(rootBefore);
      expect((rootAfter as HTMLElement).className).toBe(classesBefore);
    });
  });

  describe('fond aligné landing (MAN-127)', () => {
    it('le conteneur racine (monté, pas le loader) porte la classe nx-bg-grid', () => {
      const { container } = renderShell();
      const root = container.firstElementChild as HTMLElement;

      // `animate-in` ne figure que sur le shell monté, pas sur
      // `FullScreenLoader` — confirme qu'on teste le bon élément.
      expect(root.className).toMatch(/\banimate-in\b/);
      expect(root.className).toMatch(/\bnx-bg-grid\b/);
    });

    it('le loader plein écran (avant chargement de l’utilisateur) porte aussi nx-bg-grid', () => {
      useAuth.setState({ user: null, initializing: true });
      const { container } = renderShell();
      const root = container.firstElementChild as HTMLElement;

      expect(root.className).toMatch(/\bnx-bg-grid\b/);
      expect(root.className).not.toMatch(/\banimate-in\b/);
    });
  });

  describe('migration vers le composant Button partagé (MAN-111 Task 3)', () => {
    it('le bouton "Réglages" du footer sidebar porte les classes du composant Button', () => {
      renderShell();

      const settingsButton = screen.getByRole('button', { name: 'Réglages' });
      const classes = settingsButton.className.split(/\s+/);

      expect(classes.some((c) => /^hover:shadow-(sm|md)$/.test(c))).toBe(true);
    });

    it('préserve la navigation vers /settings au clic, sans régression suite à la migration', async () => {
      const user = userEvent.setup();
      renderShell();

      const settingsButton = screen.getByRole('button', { name: 'Réglages' });
      await user.click(settingsButton);

      expect(navigateMock).toHaveBeenCalledWith({ to: '/settings' });
    });
  });

  // Test d'acceptation du slice (MAN-111 Task 4) : les 3 tâches précédentes
  // ont livré l'animation d'entrée (Task 1), la profondeur visuelle du shell
  // (Task 2, cf. TitleBar.test.tsx / GroupMenu.test.tsx) et la migration des
  // boutons bruts les plus visibles vers Button (Task 3). Ici on rejoue le
  // parcours complet — montage animé + interaction sur une action migrée —
  // plutôt que chaque couche isolément. Comme pour Button.test.tsx (Task 4
  // MAN-110), ce test devrait déjà passer sans modification du shell : les
  // tâches précédentes ont livré le comportement, celui-ci le verrouille en
  // bout en bout.
  describe('test d’acceptation du slice (MAN-111 Task 4)', () => {
    it('le shell s’affiche avec l’animation d’entrée ET les boutons migrés restent fonctionnels', async () => {
      const user = userEvent.setup();
      const { container } = renderShell();

      // Montage animé (Task 1).
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toMatch(/\banimate-in\b/);
      expect(root.className).toMatch(/\bfade-in\b/);
      expect(root.className).toMatch(/\bzoom-in-/);

      // Bouton migré (Task 3) : classes du DS + comportement onClick réel.
      const settingsButton = screen.getByRole('button', { name: 'Réglages' });
      expect(settingsButton.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['inline-flex', 'items-center', 'justify-center']),
      );

      await user.click(settingsButton);
      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect(navigateMock).toHaveBeenCalledWith({ to: '/settings' });

      // Navigation clavier (critère d'acceptation du slice) : la migration ne
      // doit pas dégrader l'accessibilité. `Button` rend un <button> natif —
      // ce test verrouille ce contrat (un futur <div role="button"> le
      // casserait sans casser les tests de classes ci-dessus).
      navigateMock.mockClear();
      settingsButton.focus();
      expect(settingsButton).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(navigateMock).toHaveBeenCalledWith({ to: '/settings' });
    });
  });
  describe('navigation depuis une notif in-app (MAN-143)', () => {
    it('un clic sur une notif `todo_completed` ouvre le panel Listes', async () => {
      // Régression : le mapping kind → pane vivait en ternaire inline ici et
      // omettait `todo_completed` — le clic ne faisait donc RIEN. Il délègue
      // désormais à `notificationKindToPane` (@nexus/shared), exhaustif sur
      // `NotificationKind` et partagé avec le deep-link push.
      const user = userEvent.setup();
      groupsRef.current = [GROUP_A];
      notificationsRef.current = {
        unreadCount: 1,
        notifications: [
          {
            id: '44444444-4444-4444-4444-444444444444',
            kind: 'todo_completed',
            groupId: GROUP_A.id,
            sourceId: '55555555-5555-5555-5555-555555555555',
            payload: { completedByName: 'Lea', text: 'Acheter le pain', listTitle: 'Courses' },
            readAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      renderShell();

      await user.click(screen.getByRole('button', { name: /Notifications/ }));
      await user.click(screen.getByText(/a coché/));

      expect(await screen.findByText('Listes & tâches')).toBeInTheDocument();
    });
  });
});
