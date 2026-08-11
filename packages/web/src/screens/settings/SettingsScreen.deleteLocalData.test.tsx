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
 *
 * MAN-239 Phase 2 (describe ci-dessous) : même philosophie « mock un cran
 * plus bas », étendue à la jambe déconnexion de `useDeleteProviderLocalData`
 * quand le provider est encore connecté. `disconnectMessagingSession`
 * (`lib/queries.ts`) appelle le client HTTP `api()` (`@/lib/api`) — mocké ici
 * exactement comme dans `lib/queries.deleteMessagingSession.test.tsx` /
 * `lib/queries.deleteProviderLocalData.test.tsx` (`vi.mock('.../lib/api', ...)`
 * avec seul `api` remplacé). `useDeleteProviderLocalData` tourne donc en code
 * RÉEL de bout en bout : mutation → `disconnectMessagingSession` → `api()`
 * DELETE + `destroyProviderWebview` → `deleteProviderWebviewData` → `invoke`.
 * `useMessagingSessions` reste mocké (`useMessagingSessionsMock`, hérité de
 * Phase 1) mais devient piloté par le test : le mock de `api()` met à jour le
 * tableau de sessions retourné dès que le DELETE réussit, pour observer que
 * l'UI retombe bien à l'état "non connecté" une fois la mutation composée
 * terminée — sans dépendre de la propagation réelle de l'invalidation
 * TanStack Query à travers un hook entièrement remplacé. `useDeleteMessagingSession`
 * (le hook, distinct de `disconnectMessagingSession` qu'il réutilise en
 * interne) n'est volontairement PAS mocké dans ce fichier : `useDeleteProviderLocalData`
 * ne passe jamais par ce hook (il appelle `disconnectMessagingSession`
 * directement), donc le laisser réel n'a aucune incidence sur cette tranche —
 * mais ça évite de masquer par erreur un chemin que ce test doit prouver réel.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import type * as TauriCoreModule from '@tauri-apps/api/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
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

// MAN-239 Phase 2 : seul point de mock bas niveau supplémentaire — la jambe
// déconnexion de `disconnectMessagingSession` (`lib/queries.ts`) appelle le
// client HTTP réel `api()`. Même pattern que `lib/queries.deleteMessagingSession.test.tsx`
// / `lib/queries.deleteProviderLocalData.test.tsx` : tout le reste du module
// (`ApiError`, etc.) reste réel via `importOriginal`.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
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
    // `useDeleteProviderLocalData` ET `useDeleteMessagingSession` volontairement
    // absents de ce spread : ils restent la vraie implémentation de `actual`
    // (cf. commentaire d'en-tête — MAN-239 Phase 2 exerce la composition réelle
    // de `useDeleteProviderLocalData`, qui réutilise `disconnectMessagingSession`
    // en interne SANS passer par le hook `useDeleteMessagingSession`).
  };
});

import { SettingsScreen } from './SettingsScreen';

const mockedInvoke = vi.mocked(invoke);
const mockedApi = vi.mocked(api);

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

// MAN-239 Phase 2 : provider ENCORE connecté au moment du clic — le scénario
// que couvre le describe ci-dessous, distinct de `DISCONNECTED_DISCORD_SESSION`
// (Phase 1). `id` distinct de la session Phase 1 pour ne jamais les confondre
// si les deux describes venaient à s'entremêler par erreur.
const CONNECTED_DISCORD_SESSION: QueriesModule.MessagingSession = {
  id: '55555555-5555-5555-5555-555555555555',
  userId: TEST_USER.id,
  providerType: 'discord',
  externalId: `webview:${TEST_USER.id}`,
  displayName: 'Discord',
  status: 'connected',
  statusDetail: null,
  lastConnectedAt: new Date().toISOString(),
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

describe('Phase 2 slice: delete local data while still connected (integration)', () => {
  /**
   * "Sessions backend" pilotées par le test. `useMessagingSessionsMock`
   * (mocké au niveau module, cf. commentaire d'en-tête) lit ce tableau à
   * chaque appel — le muter depuis le mock de `api()` ci-dessous simule le
   * hard-delete réel de `disconnectMessagingSession` (`lib/queries.ts`,
   * "hard-delete la ligne en base") sans dépendre de la propagation d'une
   * invalidation TanStack Query à travers un hook entièrement remplacé par
   * `useMessagingSessionsMock`.
   */
  let sessions: QueriesModule.MessagingSession[];
  /** Ordre d'appel observé — preuve que la déconnexion précède la purge. */
  let callOrder: string[];

  /**
   * Route `invoke` (webview Tauri) ET `api()` (backend) vers des résultats
   * pilotés par test — les deux seuls points de mock bas niveau de ce
   * describe (cf. commentaire d'en-tête). `api()` n'est jamais appelé que
   * pour la jambe déconnexion de `disconnectMessagingSession` dans ce
   * describe (aucun autre hook du module mocké `@/lib/queries` n'en émet) :
   * pas besoin d'inspecter `opts` pour distinguer plusieurs endpoints,
   * contrairement à `lib/push.test.ts`.
   */
  function stubComposedFlow(opts: { disconnect: 'success' | 'failure' }) {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'provider_webview_data_status') {
        // Un provider `connected` a nécessairement une partition webview
        // (cf. `ConnectionCard.showDeleteLocalData` dans SettingsScreen.tsx) :
        // ce résultat vide prouve que l'action ne dépend pas de lui pour ce
        // statut, elle ne doit donc jamais consulter `hasLocalData` ici.
        return Promise.resolve({});
      }
      if (cmd === 'destroy_provider_webview') {
        callOrder.push('destroy-webview');
        return Promise.resolve(undefined);
      }
      if (cmd === 'delete_provider_webview_data') {
        callOrder.push('delete-local-data');
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`invoke non attendu dans ce test : ${cmd}`));
    });

    if (opts.disconnect === 'failure') {
      mockedApi.mockRejectedValue(new ApiError(500, { code: 'INTERNAL_ERROR', message: 'boom' }));
      return;
    }
    mockedApi.mockImplementation(() => {
      callOrder.push('api-disconnect');
      // Hard-delete réel (cf. JSDoc `disconnectMessagingSession`) : la
      // session disparaît de la liste renvoyée par `useMessagingSessions`,
      // elle ne repasse pas juste à `status: 'disconnected'`.
      sessions = sessions.filter((s) => s.id !== CONNECTED_DISCORD_SESSION.id);
      return Promise.resolve({ ok: true });
    });
  }

  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
    window.__TAURI_INTERNALS__ = {};
    sessions = [CONNECTED_DISCORD_SESSION];
    callOrder = [];
    useMessagingSessionsMock.mockImplementation(() => ({ data: sessions }));
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    delete window.__TAURI_INTERNALS__;
    navigateMock.mockReset();
    useMessagingSessionsMock.mockReset();
    mockedInvoke.mockReset();
    mockedApi.mockReset();
  });

  it('delete_local_data_while_connected_happy_path', async () => {
    const user = userEvent.setup();
    stubComposedFlow({ disconnect: 'success' });

    renderScreen();
    goToConnections();

    // Contrairement à Phase 1 : le provider est `connected`, l'action doit
    // s'afficher sans dépendre de `checkProviderWebviewDataStatus` (cf.
    // `ConnectionCard.showDeleteLocalData`).
    const trigger = await screen.findByRole('button', { name: 'Supprimer les données locales' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Supprimer les données locales Discord ?' });
    // Copie "encore connecté" (branchée sur `connected`, cf.
    // `ConfirmDeleteLocalDataModal` dans SettingsScreen.tsx) : distincte du
    // wording Phase 1 vérifié par `SettingsScreen.test.tsx`.
    expect(
      within(dialog).getByText(
        'Tu vas être déconnecté de Discord et tes données de connexion locales seront supprimées sur cet appareil. À ta prochaine connexion, tu devras te réauthentifier complètement.',
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

    // Le backend est appelé pour déconnecter la session — même endpoint que
    // "Déconnecter" explicite (cf. `lib/queries.deleteMessagingSession.test.tsx`)
    // — AVANT toute purge de la partition webview.
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          path: `/me/messaging/sessions/${CONNECTED_DISCORD_SESSION.id}`,
        }),
      ),
    );
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith('delete_provider_webview_data', {
        label: DISCORD_LABEL,
      }),
    );
    // Ordre strict : déconnexion backend (+ destroy webview) AVANT la purge
    // — jamais l'inverse (cf. JSDoc `useDeleteProviderLocalData`).
    expect(callOrder).toEqual(['api-disconnect', 'destroy-webview', 'delete-local-data']);

    expect(await screen.findByText('Données locales Discord supprimées.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // La session nexus a été hard-deleted (déconnexion) ET la partition
    // purgée : le provider retombe à l'état "jamais connecté" — l'action ne
    // doit plus être proposée, et le badge "Connecté" a disparu.
    expect(
      screen.queryByRole('button', { name: 'Supprimer les données locales' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Connecté')).not.toBeInTheDocument();
  });

  it('delete_local_data_disconnect_fails_no_delete', async () => {
    const user = userEvent.setup();
    stubComposedFlow({ disconnect: 'failure' });

    renderScreen();
    goToConnections();

    const trigger = await screen.findByRole('button', { name: 'Supprimer les données locales' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Supprimer les données locales Discord ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          path: `/me/messaging/sessions/${CONNECTED_DISCORD_SESSION.id}`,
        }),
      ),
    );

    // La purge de la partition ne doit JAMAIS être tentée si la déconnexion
    // a échoué — garantie explicite de MAN-239 Phase 2 (pas de purge sans
    // déconnexion confirmée, cf. JSDoc `useDeleteProviderLocalData`).
    expect(mockedInvoke).not.toHaveBeenCalledWith('destroy_provider_webview', expect.anything());
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'delete_provider_webview_data',
      expect.anything(),
    );

    // Message d'erreur PERSISTANT (pas un toast auto-dismiss) : le modal se
    // ferme (`finally` de `handleDeleteLocalData`), mais l'erreur reste
    // affichée — contrairement au toast de succès du test précédent, elle
    // n'a pas de `setTimeout` qui l'efface.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      await screen.findByText('Impossible de supprimer les données locales. Réessaie.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Données locales Discord supprimées.')).not.toBeInTheDocument();

    // La session nexus est toujours là (le hard-delete n'a jamais abouti) :
    // le provider reste `connected`, l'action reste proposée pour une
    // nouvelle tentative.
    expect(
      screen.getByRole('button', { name: 'Supprimer les données locales' }),
    ).toBeInTheDocument();
  });
});
