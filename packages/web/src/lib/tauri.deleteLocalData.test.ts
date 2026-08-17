/**
 * `checkProviderWebviewDataStatus` / `deleteProviderWebviewData` (MAN-239
 * Phase 1) — mêmes garanties que les autres wrappers de `tauri.ts` : no-op
 * hors runtime Tauri (pas d'appel `invoke`, pas de throw), délégation directe
 * à la commande Rust correspondante sinon.
 */
import { invoke } from '@tauri-apps/api/core';
import type * as TauriCoreModule from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkProviderWebviewDataStatus, deleteProviderWebviewData } from './tauri';

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriCoreModule>();
  return { ...actual, invoke: vi.fn() };
});

const mockedInvoke = vi.mocked(invoke);

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

describe('checkProviderWebviewDataStatus', () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    mockedInvoke.mockReset();
  });

  it('no-ops outside Tauri : renvoie {} sans appeler invoke', async () => {
    delete window.__TAURI_INTERNALS__;

    const result = await checkProviderWebviewDataStatus(['provider:discord:user-1']);

    expect(result).toEqual({});
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('délègue à provider_webview_data_status en mode Tauri', async () => {
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockResolvedValue({ 'provider:discord:user-1': true });

    const result = await checkProviderWebviewDataStatus(['provider:discord:user-1']);

    expect(mockedInvoke).toHaveBeenCalledWith('provider_webview_data_status', {
      labels: ['provider:discord:user-1'],
    });
    expect(result).toEqual({ 'provider:discord:user-1': true });
  });
});

describe('deleteProviderWebviewData', () => {
  beforeEach(() => {
    mockedInvoke.mockResolvedValue({ ok: true, label: 'provider:discord:user-1' });
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    mockedInvoke.mockReset();
  });

  it("no-ops outside Tauri : ne throw pas, n'appelle jamais invoke", async () => {
    delete window.__TAURI_INTERNALS__;

    await expect(deleteProviderWebviewData('provider:discord:user-1')).resolves.toBeUndefined();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('délègue à delete_provider_webview_data en mode Tauri', async () => {
    window.__TAURI_INTERNALS__ = {};

    await deleteProviderWebviewData('provider:discord:user-1');

    expect(mockedInvoke).toHaveBeenCalledWith('delete_provider_webview_data', {
      label: 'provider:discord:user-1',
    });
  });
});
