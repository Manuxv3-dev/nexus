/**
 * Le calendrier mensuel doit montrer le passé ET le futur, quel que soit le
 * chip de filtre actif.
 *
 * Avant correction, `dayModifiers` et `eventsByDay` dérivaient de
 * `filteredEvents`, donc du chip : en « À venir » (défaut) aucun jour passé
 * n'était pastillé, et le sélectionner répondait « Rien le … » alors qu'un
 * événement s'y trouvait. Il fallait basculer sur « Passés » pour les voir —
 * et les événements à venir disparaissaient alors de la grille. Les deux
 * n'étaient jamais visibles ensemble, alors qu'un calendrier mensuel affiche
 * par nature les deux sur la même grille.
 *
 * Le chip filtre la LISTE. Le calendrier, lui, montre tout.
 *
 * Le mock de `useEvents` respecte le paramètre `when` : le test reste donc
 * honnête si l'implémentation change de stratégie de requête (deux appels
 * upcoming+past, ou un seul appel `all` dérivé côté client).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { useEventsMock } = vi.hoisted(() => ({ useEventsMock: vi.fn() }));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    useGroupMembers: () => ({ data: [], isPending: false, isError: false }),
    useEvent: () => ({ data: undefined, isPending: false, isError: false }),
    useEvents: useEventsMock,
  };
});

import { EventsDashboard } from './EventsDashboard';
import { buildEvent } from './testFixtures';

const GROUP_ID = '22222222-2222-4222-8222-222222222222';

// Milieu de mois : hier et demain tombent dans la même grille mensuelle, donc
// pas de jour « hors mois » qui rendrait les assertions dépendantes du calendrier.
const NOW = new Date('2026-09-15T12:00:00.000Z');
const YESTERDAY = new Date('2026-09-14T19:00:00.000Z');
const TOMORROW = new Date('2026-09-16T19:00:00.000Z');

const PAST_TITLE = 'Barbecue de la semaine derniere';
const FUTURE_TITLE = 'Soiree jeux';

const ALL_EVENTS = [
  buildEvent({ id: 'past-1', title: PAST_TITLE, startsAt: YESTERDAY.toISOString() }),
  buildEvent({ id: 'future-1', title: FUTURE_TITLE, startsAt: TOMORROW.toISOString() }),
];

const TEST_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: NOW.toISOString(),
};

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EventsDashboard groupId={GROUP_ID} />
    </QueryClientProvider>,
  );
}

/** Les cellules de jour porteuses d'un événement, dans l'ordre du calendrier. */
function eventDays(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.rdp-has-event'));
}

/** DayPicker v9 rend un bouton dans la cellule ; on clique le plus interne. */
function clickDay(cell: HTMLElement) {
  fireEvent.click(cell.querySelector('button') ?? cell);
}

describe('EventsDashboard — le calendrier montre le passé comme le futur', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useAuth.setState({ user: TEST_USER, initializing: false });

    useEventsMock.mockImplementation(
      (_groupId: string | undefined, filter?: { when?: 'upcoming' | 'past' | 'all' }) => {
        const when = filter?.when ?? 'all';
        const now = Date.now();
        const data = ALL_EVENTS.filter((e) => {
          const t = new Date(e.startsAt).getTime();
          if (when === 'upcoming') return t >= now;
          if (when === 'past') return t < now;
          return true;
        });
        return { data, isPending: false, isError: false, isLoading: false };
      },
    );
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    useEventsMock.mockClear();
    vi.useRealTimers();
  });

  it('pastille un jour passé alors que le chip « À venir » est actif', () => {
    const { container } = renderDashboard();

    // Deux jours porteurs : hier et demain. Avant correction, le chip « À
    // venir » (défaut) n'en laissait qu'un — le calendrier taisait le passé.
    expect(eventDays(container)).toHaveLength(2);
  });

  it("liste l'événement d'un jour passé quand on le sélectionne, sans changer de chip", () => {
    const { container } = renderDashboard();

    const [pastDay] = eventDays(container);
    if (!pastDay) throw new Error('aucun jour pastillé dans le calendrier');
    clickDay(pastDay);

    // Le détail du jour, c'est la moitié de la demande : se positionner sur
    // une journée doit montrer ce qui s'y est passé.
    expect(screen.getByText(PAST_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(/^Rien le /)).not.toBeInTheDocument();
  });

  it('garde le chip « Passés » fonctionnel pour filtrer la liste', () => {
    const { container } = renderDashboard();

    fireEvent.click(screen.getByText('Passés'));

    // Le chip filtre la liste — mais le calendrier continue de tout montrer,
    // sinon on aurait juste déplacé le problème.
    expect(eventDays(container)).toHaveLength(2);
    expect(screen.getByText(PAST_TITLE)).toBeInTheDocument();
  });
});
