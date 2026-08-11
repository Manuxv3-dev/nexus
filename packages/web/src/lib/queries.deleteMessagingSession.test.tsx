/**
 * `useDeleteMessagingSession` — régression MAN-238. Avant ce correctif, la
 * webview Tauri détruite au disconnect (et recréée à la reconnexion, cf.
 * `WebviewProviderPane.tsx`) était labellisée à partir de `sessionId` —
 * `sessions.id` est un `uuid().defaultRandom()` et la route DELETE fait un
 * hard delete, donc reconnecter le même provider mintait un nouveau
 * `session.id` → un nouveau label → un nouveau `data_directory` vide côté
 * Tauri (`packages/desktop/src-tauri/src/webview.rs`) : cookies orphelins,
 * ré-authentification complète forcée (QR code, login…) à chaque
 * déconnexion/reconnexion.
 *
 * Le label doit désormais être dérivé de `(providerType, userId)` — identité
 * stable garantie unique côté backend (`externalId = 'webview:${userId}'`,
 * `packages/backend/src/routes/messaging/index.ts`) — indépendante de l'id
 * de session éphémère.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import type * as ApiModule from './api';
import { useDeleteMessagingSession } from './queries';
import * as TauriModule from './tauri';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, destroyProviderWebview: vi.fn().mockResolvedValue(undefined) };
});

const mockedApi = vi.mocked(api);
const mockedDestroy = vi.mocked(TauriModule.destroyProviderWebview);

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OLD_SESSION_ID = '22222222-2222-2222-2222-222222222222';
const NEW_SESSION_ID = '33333333-3333-3333-3333-333333333333';

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useDeleteMessagingSession', () => {
  afterEach(() => {
    mockedApi.mockReset();
    mockedDestroy.mockReset();
  });

  it('test_webview_label_stable_across_session_recreate_MAN238', async () => {
    mockedApi.mockResolvedValue({ ok: true });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useDeleteMessagingSession(), { wrapper: makeWrapper(qc) });

    // Déconnexion de la session "avant reconnexion" (id A).
    await result.current.mutateAsync({
      sessionId: OLD_SESSION_ID,
      providerType: 'discord',
      userId: USER_ID,
    });
    await waitFor(() => expect(mockedDestroy).toHaveBeenCalledTimes(1));
    const labelForOldSession = mockedDestroy.mock.calls[0]?.[0];

    // Reconnexion : le backend mint un nouveau session.id (hard delete +
    // insert, même `externalId = webview:${userId}`). On simule une seconde
    // déconnexion de cette nouvelle session, même provider/utilisateur.
    await result.current.mutateAsync({
      sessionId: NEW_SESSION_ID,
      providerType: 'discord',
      userId: USER_ID,
    });
    await waitFor(() => expect(mockedDestroy).toHaveBeenCalledTimes(2));
    const labelForNewSession = mockedDestroy.mock.calls[1]?.[0];

    // Le label — donc le data_directory Tauri — doit rester identique entre
    // les deux cycles : même partition, cookies préservés, pas de nouvelle
    // ré-authentification. Assertion sur le littéral (pas sur le retour de
    // providerWebviewLabel elle-même) : le format est un contrat on-disk,
    // le faire glisser silencieusement re-authentifierait tout le parc.
    expect(labelForOldSession).toBe(`provider:discord:${USER_ID}`);
    expect(labelForOldSession).toBe(labelForNewSession);
    expect(labelForOldSession).not.toContain(OLD_SESSION_ID);
    expect(labelForNewSession).not.toContain(NEW_SESSION_ID);
  });
});
