/**
 * SettingsScreen — test d'intégration bout-en-bout MAN-239 Phase 1
 * ("supprimer les données locales").
 *
 * Contrairement à `SettingsScreen.test.tsx` (task 4), qui mocke
 * `checkProviderWebviewDataStatus` (module `@/lib/tauri`) et
 * `useDeleteProviderLocalData` (module `@/lib/queries`) directement pour
 * isoler l'UI, ce fichier mocke UN cran plus bas : `invoke` de
 * `@tauri-apps/api/core` (même pattern que
 * `../app/WebviewProviderPane.label.test.tsx`) et la détection de mode Tauri
 * (`window.__TAURI_INTERNALS__`, cf. `isTauri()` dans `@/lib/tauri`).
 * `@/lib/tauri` (checkProviderWebviewDataStatus, deleteProviderWebviewData,
 * providerWebviewLabel, isTauri) et la mutation `useDeleteProviderLocalData`
 * tournent donc en code RÉEL, non mocké — seuls `useGroups` /
 * `useMessagingSessions` / etc. (sans rapport avec cette tranche) et le
 * router restent mockés, comme dans `SettingsScreen.test.tsx`.
 *
 * Objectif : prouver que toute la tranche verticale de MAN-239 Phase 1 (UI →
 * mutation `useDeleteProviderLocalData` → wrapper `tauri.ts` → `invoke`
 * Tauri) fonctionne ensemble de bout en bout, pas seulement chaque maillon
 * en isolation (déjà couvert par les tests unitaires de task 4 et par
 * `lib/tauri.deleteLocalData.test.ts` / `lib/queries.deleteProviderLocalData.test.tsx`
 * de task 3). C'est le plancher réaliste pour ce repo : pas de couverture
 * Playwright de l'IPC desktop Tauri, cf. stratégie de test documentée de la
 * phase.
 *
 * Fichier séparé (plutôt qu'ajouté à `SettingsScreen.test.tsx`) : le régime
 * de mock diverge sur des points structurants (pas de mock de `@/lib/tauri`
 * ni de `useDeleteProviderLocalData`, mock supplémentaire de
 * `@tauri-apps/api/core`) — les coexister dans un seul fichier aurait
 * multiplié les blocs `vi.mock` conditionnels et rendu le régime de mock de
 * chaque test moins lisible.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import type * as TauriCoreModule from '@tauri-apps/api/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
const { useMessagingSessionsMock } = vi.hoisted(() => ({
  useMessagingSessionsMock: vi.fn<() => { data: QueriesModule.MessagingSession[] }>(() => ({
    data: [],
  })),
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriCoreModule>();
  return { ...actual, invoke: vi.fn() };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => navigateMock };
});

// `@/lib/tauri` n'est PAS mocké dans ce fichier : `checkProviderWebviewDataStatus`,
// `deleteProviderWebviewData`, `providerWebviewLabel` et `isTauri` tournent en
// code réel — seul `invoke` (mocké ci-dessus) coupe le pont vers le vrai
// runtime Tauri.
vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
    useMessagingSessions: useMessagingSessionsMock,
    useNotificationPrefs: () => ({ data: undefined }),
    useUpdateNotificationPrefs: () => ({ mutate: vi.fn() }),
    useConnectWebviewProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteMessagingSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
    // `useDeleteProviderLocalData` volontairement absent de ce spread : il
    // reste la vraie implémentation de `actual`, cf. commentaire d'en-tête.
  };
});

import { SettingsScreen } from './SettingsScreen';

const mockedInvoke = vi.mocked(invoke);

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
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

// Provider déconnecté côté nexus mais avec une partition webview encore sur
// disque — le scénario que MAN-239 Phase 1 cible explicitement (cf.
// `ConnectionCard.showDeleteLocalData` dans SettingsScreen.tsx : l'action ne
// s'affiche jamais pour un provider `connected`/`connecting`).
const DISCONNECTED_DISCORD_SESSION: QueriesModule.MessagingSession = {
  id: '33333333-3333-3333-3333-333333333333',
  userId: TEST_USER.id,
  providerType: 'discord',
  externalId: `webview:${TEST_USER.id}`,
  displayName: 'Discord',
  status: 'disconnected',
  statusDetail: null,
  lastConnectedAt: null,
  lastError: null,
  createdBy: TEST_USER.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Convention `provider:{providerType}:{userId}` (cf. `providerWebviewLabel`,
// `lib/tauri.ts`) recalculée explicitement ici plutôt qu'importée : ce test
// doit échouer bruyamment si la convention de label change sans que ce
// fichier soit mis à jour (même rationale que `SettingsScreen.test.tsx`).
const DISCORD_LABEL = `provider:discord:${TEST_USER.id}`;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
}

function goToConnections() {
  fireEvent.click(screen.getByText('Connexions messageries'));
}

/**
 * Route les commandes `invoke` mockées vers des résultats pilotés par test,
 * comme le ferait réellement le backend Rust — c'est le seul point de mock
 * bas niveau de ce fichier (cf. commentaire d'en-tête).
 */
function stubInvoke(dataStatus: Record<string, boolean>) {
  mockedInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'provider_webview_data_status') {
      return Promise.resolve(dataStatus);
    }
    if (cmd === 'delete_provider_webview_data') {
      return Promise.resolve(undefined);
    }
    return Promise.reject(new Error(`invoke non attendu dans ce test : ${cmd}`));
  });
}

describe('Phase 1 slice: delete local webview data (integration)', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
    window.__TAURI_INTERNALS__ = {};
    useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    delete window.__TAURI_INTERNALS__;
    navigateMock.mockReset();
    useMessagingSessionsMock.mockReset();
    mockedInvoke.mockReset();
  });

  it('delete_local_data_happy_path', async () => {
    const user = userEvent.setup();
    stubInvoke({ [DISCORD_LABEL]: true });

    renderScreen();
    goToConnections();

    // Preuve que la lecture initiale (checkProviderWebviewDataStatus → real
    // wrapper → invoke) a bien tourné, pas juste que l'action s'affiche par
    // hasard.
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        'provider_webview_data_status',
        expect.objectContaining({ labels: expect.arrayContaining([DISCORD_LABEL]) as unknown }),
      ),
    );

    const trigger = await screen.findByRole('button', { name: 'Supprimer les données locales' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Supprimer les données locales Discord ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

    // Le label passé à `invoke('delete_provider_webview_data', ...)` doit
    // être exactement celui produit par `providerWebviewLabel(providerType,
    // userId)` — traversant réellement UI → mutation → wrapper tauri.ts.
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith('delete_provider_webview_data', {
        label: DISCORD_LABEL,
      }),
    );

    expect(await screen.findByText('Données locales Discord supprimées.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Les données locales sont désormais parties : l'action ne doit plus
    // être proposée pour ce provider.
    expect(
      screen.queryByRole('button', { name: 'Supprimer les données locales' }),
    ).not.toBeInTheDocument();
  });

  it('delete_local_data_not_offered_without_data', async () => {
    stubInvoke({ [DISCORD_LABEL]: false });

    renderScreen();
    goToConnections();

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        'provider_webview_data_status',
        expect.objectContaining({ labels: expect.arrayContaining([DISCORD_LABEL]) as unknown }),
      ),
    );

    expect(
      screen.queryByRole('button', { name: 'Supprimer les données locales' }),
    ).not.toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'delete_provider_webview_data',
      expect.anything(),
    );
  });
});
