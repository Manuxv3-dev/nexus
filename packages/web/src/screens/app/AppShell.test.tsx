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

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
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

describe('AppShell', () => {
  beforeEach(() => {
    navigateMock.mockClear();
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
      expect(root.className).toMatch(/\bslide-in-from-/);
    });

    it('ne rejoue pas l’animation lors d’un re-render sans démontage (ex: switch de groupe)', () => {
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
});
