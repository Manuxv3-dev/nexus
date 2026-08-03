/**
 * SettingsScreen — section "À propos" (MAN-133, Phase 1 de MAN-132).
 *
 * On mocke `@tanstack/react-router` (pas de RouterProvider réel nécessaire
 * pour tester l'écran en isolation) et `@/lib/queries` (pas d'appel réseau
 * réel en test). `useAuth` est un store zustand : piloté directement via
 * `setState`, pas besoin de mock de module.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
    useMessagingSessions: () => ({ data: [] }),
    useNotificationPrefs: () => ({ data: undefined }),
    useUpdateNotificationPrefs: () => ({ mutate: vi.fn() }),
    useConnectWebviewProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteMessagingSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { SettingsScreen } from './SettingsScreen';

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsScreen />
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

describe('SettingsScreen', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    vi.unstubAllEnvs();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  describe('section "À propos" (MAN-133)', () => {
    it("affiche l'identifiant de build web quand VITE_GIT_SHA est défini", () => {
      vi.stubEnv('VITE_GIT_SHA', 'sha-a1b2c3d');
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.getByText('sha-a1b2c3d')).toBeInTheDocument();
    });

    it('affiche un texte de repli quand VITE_GIT_SHA est absent (jamais "undefined")', () => {
      vi.stubEnv('VITE_GIT_SHA', undefined);
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.queryByText('undefined')).not.toBeInTheDocument();
      expect(screen.getByText('build inconnu')).toBeInTheDocument();
    });

    it('affiche aussi le texte de repli quand VITE_GIT_SHA est une chaîne vide (mauvaise config CI)', () => {
      vi.stubEnv('VITE_GIT_SHA', '');
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.getByText('build inconnu')).toBeInTheDocument();
    });

    it("n'affiche pas l'identifiant de build web quand l'app tourne dans Tauri", () => {
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      vi.stubEnv('VITE_GIT_SHA', 'sha-a1b2c3d');
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.queryByText('sha-a1b2c3d')).not.toBeInTheDocument();
      expect(screen.queryByText('À propos')).not.toBeInTheDocument();
    });
  });
});
