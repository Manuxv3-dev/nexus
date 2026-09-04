/**
 * `useHomeFeed` — le maillon qui porte la correction du calendrier de la Home,
 * et le seul qui n'était couvert par aucun test.
 *
 * Les tests d'écran (`HomeDashboard.weekCalendar.test.tsx`) mockent le hook en
 * bloc : ils prouvent que `HomeDashboard` sait afficher des `weekEvents`, pas
 * que le hook sait les demander. Or si un refactor perdait les query params,
 * rien ne deviendrait rouge — le backend renverrait simplement une section
 * vide (la fenêtre est opt-in), et le calendrier redeviendrait désert en
 * silence. C'est exactement la classe de panne que ce ticket corrige.
 *
 * Testé au niveau du hook, avec `api` mocké, sur le modèle de
 * `queries.leaveGroup.test.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import type * as ApiModule from './api';
import { useHomeFeed } from './queries';
import { currentWeekBounds } from './week';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

const EMPTY_FEED = {
  pendingRsvps: [],
  unsettledExpenses: [],
  assignedTodos: [],
  upcomingEvents: [],
  weekEvents: [],
  pendingPolls: [],
  unreadByGroup: [],
};

/** Mercredi 16 septembre 2026 — milieu de semaine, loin des bornes. */
const WEDNESDAY = new Date(2026, 8, 16, 12, 0, 0, 0);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Le `path` du dernier appel à `api`, décodé (URLSearchParams percent-encode
 *  les `:` de l'ISO 8601). */
function lastPath(): string {
  const call = mockedApi.mock.calls.at(-1)?.[0] as { path: string } | undefined;
  return decodeURIComponent(call?.path ?? '');
}

describe('useHomeFeed — les bornes de semaine voyagent jusqu’au backend', () => {
  beforeEach(() => {
    // `toFake: ['Date']` et rien d'autre : figer aussi setTimeout/queueMicrotask
    // gèlerait la machinerie async de TanStack Query et de `waitFor`, qui
    // n'aboutiraient jamais. On veut une horloge déterministe, pas un temps
    // arrêté.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(WEDNESDAY);
    mockedApi.mockResolvedValue(EMPTY_FEED);
  });

  afterEach(() => {
    mockedApi.mockReset();
    vi.useRealTimers();
  });

  it('envoie weekStart et weekEnd, calculés en heure locale', async () => {
    const { result } = renderHook(() => useHomeFeed(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const { start, end } = currentWeekBounds(WEDNESDAY);
    const path = lastPath();
    expect(path).toContain(`weekStart=${start.toISOString()}`);
    expect(path).toContain(`weekEnd=${end.toISOString()}`);
    // Le lundi de cette semaine-là, en local — pas une date UTC arbitraire.
    expect(start.getDay()).toBe(1);
  });

  it('change de queryKey quand la semaine bascule', async () => {
    // Sans les bornes dans la clé, une app laissée ouverte du dimanche au lundi
    // resservirait indéfiniment le cache de la semaine écoulée.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useHomeFeed(), { wrapper: shared });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const keysBefore = qc.getQueryCache().getAll().length;

    // Une semaine plus tard : nouvelle fenêtre, donc nouvelle entrée de cache.
    const nextWeek = new Date(2026, 8, 23, 12, 0, 0, 0);
    vi.setSystemTime(nextWeek);
    const second = renderHook(() => useHomeFeed(), { wrapper: shared });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(qc.getQueryCache().getAll().length).toBeGreaterThan(keysBefore);
    // Comparé à la valeur recalculée, pas à un littéral : l'ISO d'un lundi
    // local dépend du fuseau de la machine, et la CI tourne en UTC.
    expect(lastPath()).toContain(`weekStart=${currentWeekBounds(nextWeek).start.toISOString()}`);
  });
});
