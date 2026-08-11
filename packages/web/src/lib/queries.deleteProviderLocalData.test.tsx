/**
 * `useDeleteProviderLocalData` (MAN-239 Phase 1) — chemin direct : purge le
 * `data_directory` Tauri d'un provider via son label canonique
 * `provider:{providerType}:{userId}` (`providerWebviewLabel`, cf.
 * `lib/tauri.ts`). Aucun appel backend ici — purement Tauri, contrairement à
 * `useDeleteMessagingSession` qui combine API + destroy webview.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeleteProviderLocalData } from './queries';
import * as TauriModule from './tauri';

vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, deleteProviderWebviewData: vi.fn() };
});

const mockedDelete = vi.mocked(TauriModule.deleteProviderWebviewData);

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useDeleteProviderLocalData', () => {
  afterEach(() => {
    mockedDelete.mockReset();
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
});
