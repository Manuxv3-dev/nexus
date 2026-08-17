/**
 * `useWebviewPartitionSweep` (MAN-239 Phase 3) — déclenchement du balayage des
 * partitions webview orphelines au démarrage.
 *
 * Trois garanties couvertes ici, dans l'ordre de gravité si elles cassent :
 *
 * 1. **Ne jamais balayer avant que les sessions soient réellement résolues.**
 *    `useMessagingSessions().data` vaut `undefined` pendant le chargement et
 *    les appelants font typiquement `data ?? []` — balayer sur ce `[]`
 *    transitoire supprimerait la partition de TOUS les providers connectés
 *    (ré-authentification forcée partout). C'est le mode de défaillance
 *    dangereux de cette tranche, d'où un test dédié.
 * 2. La keep-list correspond exactement à `providerWebviewLabel(providerType,
 *    userId)` pour chaque session — assertée sur des littéraux plutôt qu'en
 *    réimportant le helper, pour que le test échoue bruyamment si la
 *    convention de label change (même parti pris que
 *    `SettingsScreen.test.tsx`).
 * 3. Un seul balayage par montage : les refetch/invalidations de
 *    `useMessagingSessions()` renvoient un nouveau tableau à chaque fois, et
 *    ne doivent pas relancer le sweep.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MessagingSession } from '@/lib/queries';
import type * as TauriModule from '@/lib/tauri';

const { sweepMock } = vi.hoisted(() => ({ sweepMock: vi.fn(() => Promise.resolve()) }));

vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, sweepOrphanedWebviewPartitions: sweepMock };
});

import { useWebviewPartitionSweep } from './useWebviewPartitionSweep';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function session(
  providerType: MessagingSession['providerType'],
  userId: string = USER_ID,
): Pick<MessagingSession, 'providerType' | 'userId'> {
  return { providerType, userId };
}

describe('useWebviewPartitionSweep', () => {
  afterEach(() => {
    sweepMock.mockClear();
  });

  it('ne balaie pas tant que les sessions ne sont pas résolues', () => {
    renderHook(() => useWebviewPartitionSweep({ enabled: false, sessions: [] }));

    expect(sweepMock).not.toHaveBeenCalled();
  });

  it('balaie avec les labels dérivés des sessions dès leur résolution', () => {
    renderHook(() =>
      useWebviewPartitionSweep({
        enabled: true,
        sessions: [session('discord'), session('whatsapp')],
      }),
    );

    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(sweepMock).toHaveBeenCalledWith([
      `provider:discord:${USER_ID}`,
      `provider:whatsapp:${USER_ID}`,
    ]);
  });

  it("balaie avec une keep-list vide quand aucune session n'est connectée", () => {
    renderHook(() => useWebviewPartitionSweep({ enabled: true, sessions: [] }));

    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(sweepMock).toHaveBeenCalledWith([]);
  });

  it("ne balaie qu'une fois : un refetch des sessions ne redéclenche rien", () => {
    const { rerender } = renderHook(
      ({ sessions }: { sessions: Pick<MessagingSession, 'providerType' | 'userId'>[] }) =>
        useWebviewPartitionSweep({ enabled: true, sessions }),
      { initialProps: { sessions: [session('discord')] } },
    );

    expect(sweepMock).toHaveBeenCalledTimes(1);

    // Refetch : même contenu, nouvelle identité de tableau (ce que renvoie
    // TanStack Query après une invalidation).
    rerender({ sessions: [session('discord')] });
    // Puis un refetch qui change réellement le contenu (nouveau provider
    // connecté pendant la session d'app) : toujours pas de second balayage,
    // la partition fraîchement créée n'est pas dans la keep-list initiale.
    rerender({ sessions: [session('discord'), session('telegram')] });

    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it('ne balaie pas rétroactivement si les sessions repassent en chargement', () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useWebviewPartitionSweep({ enabled, sessions: [session('discord')] }),
      { initialProps: { enabled: false } },
    );

    expect(sweepMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(sweepMock).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it('avale une erreur de balayage sans la propager', async () => {
    sweepMock.mockRejectedValueOnce(new Error('partition verrouillée'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderHook(() => useWebviewPartitionSweep({ enabled: true, sessions: [session('discord')] }));

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
