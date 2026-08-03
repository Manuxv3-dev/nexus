/**
 * SettingsScreen — section "À propos" (MAN-133 : build web, MAN-134 :
 * version desktop).
 *
 * On mocke `@tanstack/react-router` (pas de RouterProvider réel nécessaire
 * pour tester l'écran en isolation) et `@/lib/queries` (pas d'appel réseau
 * réel en test). `useAuth` est un store zustand : piloté directement via
 * `setState`, pas besoin de mock de module. `getVersion()` de
 * `@tauri-apps/api/app` est mocké via `vi.hoisted` pour contrôler sa
 * résolution/rejet par test (même principe que le mock de
 * `@tauri-apps/api/window` dans `TitleBar.test.tsx`, mais celui-ci a besoin
 * d'un résultat piloté, pas juste d'une présence/absence).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { getVersionMock } = vi.hoisted(() => ({ getVersionMock: vi.fn() }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: getVersionMock }));

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
    getVersionMock.mockReset();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  describe('section "À propos" — build web (MAN-133)', () => {
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
  });

  describe('section "À propos" — version desktop (MAN-134)', () => {
    it("n'appelle pas getVersion() (API desktop) quand l'app ne tourne pas dans Tauri", () => {
      vi.stubEnv('VITE_GIT_SHA', 'sha-a1b2c3d');
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(getVersionMock).not.toHaveBeenCalled();
    });

    it(
      "affiche exactement la valeur résolue par getVersion() (pas l'identifiant de build " +
        "web) quand l'API Tauri est disponible — valeur volontairement improbable pour " +
        "prouver qu'elle vient bien de l'API mockée, pas d'une coïncidence avec la vraie " +
        'version du repo',
      async () => {
        (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        getVersionMock.mockResolvedValue('9.9.9-from-tauri');
        vi.stubEnv('VITE_GIT_SHA', 'sha-a1b2c3d');
        renderScreen();

        fireEvent.click(screen.getByText('Sécurité'));

        expect(await screen.findByText('9.9.9-from-tauri')).toBeInTheDocument();
        expect(screen.queryByText('sha-a1b2c3d')).not.toBeInTheDocument();
        expect(getVersionMock).toHaveBeenCalledTimes(1);
      },
    );

    it('affiche un état de chargement tant que getVersion() est en attente', async () => {
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      let resolveVersion!: (v: string) => void;
      getVersionMock.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveVersion = resolve;
        }),
      );
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.getByText('…')).toBeInTheDocument();

      resolveVersion('0.2.1');
      expect(await screen.findByText('0.2.1')).toBeInTheDocument();
    });

    it('affiche un repli propre quand getVersion() échoue (API Tauri indisponible)', async () => {
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      getVersionMock.mockRejectedValue(new Error('API Tauri indisponible'));
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(await screen.findByText('version indisponible')).toBeInTheDocument();
    });
  });
});
