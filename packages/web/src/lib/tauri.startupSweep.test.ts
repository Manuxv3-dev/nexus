/**
 * `sweepOrphanedWebviewPartitions` (MAN-239 Phase 3) — mêmes garanties que les
 * autres wrappers de `tauri.ts` : no-op hors runtime Tauri (pas d'appel
 * `invoke`, pas de throw), délégation directe à la commande Rust sinon.
 *
 * Le nom de la clé d'argument (`keepLabels`) est assertée explicitement : côté
 * Rust le paramètre s'appelle `keep_labels`, et c'est Tauri qui fait la
 * conversion camelCase → snake_case. Un renommage silencieux ici passerait le
 * typecheck mais produirait une commande qui échoue au runtime desktop
 * uniquement — hors de portée du reste de la suite.
 */
import { invoke } from '@tauri-apps/api/core';
import type * as TauriCoreModule from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sweepOrphanedWebviewPartitions } from './tauri';

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

describe('sweepOrphanedWebviewPartitions', () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    mockedInvoke.mockReset();
  });

  it('no-ops outside Tauri : rapport vide, sans appeler invoke', async () => {
    delete window.__TAURI_INTERNALS__;

    const report = await sweepOrphanedWebviewPartitions(['provider:discord:user-1']);

    expect(report).toEqual({ removed: 0, kept: 0, failed: 0 });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('délègue à sweep_orphaned_webview_partitions en mode Tauri', async () => {
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockResolvedValue({ removed: 2, kept: 1, failed: 0 });

    const report = await sweepOrphanedWebviewPartitions([
      'provider:discord:user-1',
      'provider:whatsapp:user-1',
    ]);

    expect(mockedInvoke).toHaveBeenCalledWith('sweep_orphaned_webview_partitions', {
      keepLabels: ['provider:discord:user-1', 'provider:whatsapp:user-1'],
    });
    expect(report).toEqual({ removed: 2, kept: 1, failed: 0 });
  });

  it('transmet une keep-list vide telle quelle (aucun provider connecté)', async () => {
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockResolvedValue({ removed: 3, kept: 0, failed: 0 });

    await sweepOrphanedWebviewPartitions([]);

    expect(mockedInvoke).toHaveBeenCalledWith('sweep_orphaned_webview_partitions', {
      keepLabels: [],
    });
  });
});
