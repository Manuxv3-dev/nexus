/**
 * `useDeleteProviderLocalData` (MAN-239 Phase 1 + 2) — purge le
 * `data_directory` Tauri d'un provider via son label canonique
 * `provider:{providerType}:{userId}` (`providerWebviewLabel`, cf.
 * `lib/tauri.ts`).
 *
 * Phase 1 : chemin direct, purement Tauri, aucun appel backend.
 *
 * Phase 2 (MAN-239) : si l'appelant passe `session` avec `status ===
 * 'connected'`, la mutation déconnecte D'ABORD la session nexus (même appel
 * que `useDeleteMessagingSession` : DELETE backend + destroy webview) avant
 * de purger la partition — sinon la webview resterait ouverte sur un
 * `data_directory` supprimé sous ses pieds. Si le disconnect échoue, la
 * purge n'a pas lieu (pas de "déconnecté silencieusement mais pas purgé" —
 * inverse : pas de purge sans déconnexion confirmée).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import type * as ApiModule from './api';
import { useDeleteProviderLocalData } from './queries';
import * as TauriModule from './tauri';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return {
    ...actual,
    deleteProviderWebviewData: vi.fn(),
    destroyProviderWebview: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);
const mockedDelete = vi.mocked(TauriModule.deleteProviderWebviewData);
const mockedDestroy = vi.mocked(TauriModule.destroyProviderWebview);

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '44444444-4444-4444-4444-444444444444';

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useDeleteProviderLocalData', () => {
  afterEach(() => {
    mockedDelete.mockReset();
    mockedApi.mockReset();
    mockedDestroy.mockReset();
  });

  it('appelle deleteProviderWebviewData avec le label dérivé de (providerType, userId)', async () => {
    mockedDelete.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteProviderLocalData(), {
      wrapper: makeWrapper(qc),
    });

    result.current.mutate({ providerType: 'discord', userId: USER_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith(`provider:discord:${USER_ID}`);
  });

  it('résout avec le label supprimé en cas de succès', async () => {
    mockedDelete.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteProviderLocalData(), {
      wrapper: makeWrapper(qc),
    });

    const output = await result.current.mutateAsync({ providerType: 'whatsapp', userId: USER_ID });

    expect(output).toEqual({ label: `provider:whatsapp:${USER_ID}` });
  });

  it("propage l'erreur si deleteProviderWebviewData échoue (pas de swallow silencieux)", async () => {
    mockedDelete.mockRejectedValue(new Error('fs error'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteProviderLocalData(), {
      wrapper: makeWrapper(qc),
    });

    result.current.mutate({ providerType: 'discord', userId: USER_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  // ─────────────────────── MAN-239 Phase 2 ───────────────────────

  it('test_composes_disconnect_then_delete_when_connected', async () => {
    const callOrder: string[] = [];
    mockedApi.mockImplementation(() => {
      callOrder.push('api-disconnect');
      return Promise.resolve({ ok: true });
    });
    mockedDestroy.mockImplementation(() => {
      callOrder.push('destroy-webview');
      return Promise.resolve(undefined);
    });
    mockedDelete.mockImplementation(() => {
      callOrder.push('delete-local-data');
      return Promise.resolve(undefined);
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteProviderLocalData(), {
      wrapper: makeWrapper(qc),
    });

    const output = await result.current.mutateAsync({
      providerType: 'discord',
      userId: USER_ID,
      session: { id: SESSION_ID, status: 'connected' },
    });

    expect(mockedApi).toHaveBeenCalledTimes(1);
    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: `/me/messaging/sessions/${SESSION_ID}`,
      }),
    );
    expect(mockedDestroy).toHaveBeenCalledTimes(1);
    expect(mockedDestroy).toHaveBeenCalledWith(`provider:discord:${USER_ID}`);
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith(`provider:discord:${USER_ID}`);
    expect(output).toEqual({ label: `provider:discord:${USER_ID}` });
    // Ordre strict : déconnexion (api + destroy webview) AVANT la purge.
    expect(callOrder).toEqual(['api-disconnect', 'destroy-webview', 'delete-local-data']);
  });

  it('test_direct_delete_when_already_disconnected (régression Phase 1)', async () => {
    mockedDelete.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteProviderLocalData(), {
      wrapper: makeWrapper(qc),
    });

    await result.current.mutateAsync({
      providerType: 'discord',
      userId: USER_ID,
      session: { id: SESSION_ID, status: 'disconnected' },
    });

    expect(mockedApi).not.toHaveBeenCalled();
    expect(mockedDestroy).not.toHaveBeenCalled();
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith(`provider:discord:${USER_ID}`);
  });

  it('test_direct_delete_when_no_session_passed (régression Phase 1, appel historique)', async () => {
    mockedDelete.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteProviderLocalData(), {
      wrapper: makeWrapper(qc),
    });

    await result.current.mutateAsync({ providerType: 'discord', userId: USER_ID });

    expect(mockedApi).not.toHaveBeenCalled();
    expect(mockedDestroy).not.toHaveBeenCalled();
    expect(mockedDelete).toHaveBeenCalledTimes(1);
  });

  it('test_disconnect_failure_aborts_delete', async () => {
    mockedApi.mockRejectedValue(new Error('backend down'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteProviderLocalData(), {
      wrapper: makeWrapper(qc),
    });

    result.current.mutate({
      providerType: 'discord',
      userId: USER_ID,
      session: { id: SESSION_ID, status: 'connected' },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    // La purge ne doit JAMAIS être tentée si la déconnexion a échoué.
    expect(mockedDestroy).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('test_disables_during_pending', async () => {
    let resolveApi: (() => void) | undefined;
    mockedApi.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApi = () => resolve({ ok: true });
        }),
    );
    mockedDestroy.mockResolvedValue(undefined);
    let resolveDelete: (() => void) | undefined;
    mockedDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = () => resolve(undefined);
        }),
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteProviderLocalData(), {
      wrapper: makeWrapper(qc),
    });

    expect(result.current.isPending).toBe(false);

    result.current.mutate({
      providerType: 'discord',
      userId: USER_ID,
      session: { id: SESSION_ID, status: 'connected' },
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));

    // Étape 1 (disconnect) en vol → toujours pending.
    resolveApi?.();
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledTimes(1));
    // Étape 2 (purge) en vol → même state pending composé, pas de "faux
    // relâchement" entre les deux étapes.
    expect(result.current.isPending).toBe(true);

    resolveDelete?.();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isSuccess).toBe(true);
  });
});
