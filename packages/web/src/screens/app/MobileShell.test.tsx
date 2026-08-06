/**
 * MobileShell — tests du shell mobile (MAN-111 Phase 2 : habillage & entrée
 * du shell/nav).
 *
 * `useAuth` est un store zustand : piloté directement via `setState`. Les
 * hooks réseau (`@/lib/queries`) sont mockés pour éviter tout appel réel.
 *
 * On mocke aussi `@tanstack/react-router` (pas de RouterProvider réel
 * nécessaire pour tester le shell en isolation, même raisonnement que
 * `AppShell.test.tsx`) : depuis MAN-151, `MobileShell` lit la query string
 * via `useRouterState` (deep-link push), qui exige un router monté. Le
 * deep-link a sa propre suite avec un vrai router
 * (`MobileShell.pushDeepLink.test.tsx`) : ici, query string vide.
 *
 * `useCreateGroup` est mocké de la même façon que `GroupsSection.test.tsx`
 * (pas le vrai hook comme `GroupsSection.create.integration.test.tsx`) : ce
 * fichier vérifie l'assemblage `MobileShell` ↔ `CreateGroupForm` ↔ mutation
 * (MAN-231), pas la vraie invalidation de cache réseau.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type { Group } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: () => '',
  };
});

let groupsState: Group[] = [];
let createGroupMutateAsync = vi.fn(
  (input: { name: string }): Promise<Group> =>
    Promise.resolve({
      id: 'new-group-id',
      name: input.name,
      createdBy: 'someone',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: 'owner',
    }),
);

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: groupsState, isLoading: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => ({ data: [] }),
    useCreateGroup: () => ({ mutateAsync: createGroupMutateAsync, isPending: false }),
  };
});

import { MobileShell } from './MobileShell';

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MobileShell />
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
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

describe('MobileShell', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    groupsState = [];
    createGroupMutateAsync = vi.fn(
      (input: { name: string }): Promise<Group> =>
        Promise.resolve({
          id: 'new-group-id',
          name: input.name,
          createdBy: 'someone',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          role: 'owner',
        }),
    );
  });

  describe('animation d’entrée (MAN-111 Task 1)', () => {
    it('porte les classes tailwindcss-animate sur le conteneur racine au montage', () => {
      const { container } = renderShell();
      const root = container.firstElementChild as HTMLElement;

      expect(root.className).toMatch(/\banimate-in\b/);
      expect(root.className).toMatch(/\bfade-in\b/);
      expect(root.className).toMatch(/\bzoom-in-/);
    });

    it('ne rejoue pas l’animation lors d’un re-render sans démontage (ex: switch d’écran)', () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { container, rerender } = render(
        <QueryClientProvider client={qc}>
          <MobileShell />
        </QueryClientProvider>,
      );
      const rootBefore = container.firstElementChild;
      const classesBefore = (rootBefore as HTMLElement).className;

      rerender(
        <QueryClientProvider client={qc}>
          <MobileShell />
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

      // `animate-in` ne figure que sur le shell monté, pas sur l'état
      // `initializing` — confirme qu'on teste le bon élément.
      expect(root.className).toMatch(/\banimate-in\b/);
      expect(root.className).toMatch(/\bnx-bg-grid\b/);
    });

    it('l’état initializing (avant chargement de l’utilisateur) porte aussi nx-bg-grid', () => {
      useAuth.setState({ user: null, initializing: true });
      const { container } = renderShell();
      const root = container.firstElementChild as HTMLElement;

      expect(root.className).toMatch(/\bnx-bg-grid\b/);
      expect(root.className).not.toMatch(/\banimate-in\b/);
    });
  });

  describe('bouton Réglages (MAN-231)', () => {
    it('navigue vers /settings au clic', async () => {
      const user = userEvent.setup();
      renderShell();

      await user.click(screen.getByRole('button', { name: 'Réglages' }));

      expect(navigateMock).toHaveBeenCalledWith({ to: '/settings' });
    });
  });

  describe('création de groupe (MAN-231)', () => {
    it('un mobinaute sans groupe a un CTA visible pour en créer un, et le trigger du header fonctionne aussi', async () => {
      groupsState = [];
      const user = userEvent.setup();
      renderShell();

      expect(screen.getByTestId('mobile-groups-empty-state')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Créer un groupe/i }));

      expect(screen.getByRole('textbox', { name: 'Nom du groupe' })).toBeInTheDocument();
      expect(screen.queryByTestId('mobile-groups-empty-state')).not.toBeInTheDocument();
    });

    it('soumettre le formulaire appelle la mutation de création avec le bon nom', async () => {
      groupsState = [];
      const user = userEvent.setup();
      renderShell();

      await user.click(screen.getByRole('button', { name: /Créer un groupe/i }));
      await user.type(screen.getByRole('textbox', { name: 'Nom du groupe' }), 'La Bande du 11e');
      await user.click(screen.getByRole('button', { name: 'Créer' }));

      expect(createGroupMutateAsync).toHaveBeenCalledWith({ name: 'La Bande du 11e' });
    });

    it('le déclencheur "Nouveau groupe" du header ouvre aussi le formulaire quand des groupes existent déjà', async () => {
      groupsState = [
        {
          id: '22222222-2222-2222-2222-222222222222',
          name: 'Groupe existant',
          createdBy: TEST_USER.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          role: 'owner',
        },
      ];
      const user = userEvent.setup();
      renderShell();

      await user.click(screen.getByRole('button', { name: 'Nouveau groupe' }));
      await user.type(screen.getByRole('textbox', { name: 'Nom du groupe' }), 'Nouvelle Bande');
      await user.click(screen.getByRole('button', { name: 'Créer' }));

      expect(createGroupMutateAsync).toHaveBeenCalledWith({ name: 'Nouvelle Bande' });
    });
  });
});
