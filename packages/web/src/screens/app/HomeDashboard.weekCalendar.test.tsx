/**
 * Le calendrier semaine de la Home Nexus doit montrer LA SEMAINE, pas
 * « mes 5 prochains events confirmés ».
 *
 * `WeekCalendar` y était alimenté par `feed.upcomingEvents`, qui vient de
 * `listUpcomingEvents` — trois restrictions cumulées, dont aucune n'est ce
 * qu'une grille Lundi → Dimanche doit rendre :
 *
 *   1. RSVP « yes » obligatoire — l'événement auquel on n'a pas encore
 *      répondu, celui qu'il faudrait justement voir, n'apparaissait jamais ;
 *   2. futur strict (`startsAt > now()`) — les jours déjà écoulés de la
 *      semaine étaient vides par construction ;
 *   3. `limit 5` — au-delà, la semaine était tronquée en silence.
 *
 * Le champ n'était pas en cause : il sert aussi la carte « Mes prochains
 * events », où le top 5 filtré par RSVP est le bon comportement. C'est de le
 * réutiliser comme source d'un calendrier qui ne va pas — d'où `weekEvents`,
 * un champ dédié, et le troisième test qui verrouille la frontière entre les
 * deux.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { useHomeFeedMock } = vi.hoisted(() => ({ useHomeFeedMock: vi.fn() }));

const EMPTY = { data: [], isPending: false, isError: false, isLoading: false };

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useHomeFeed: useHomeFeedMock,
    useGroups: () => ({
      data: [{ id: GROUP_ID, name: 'La Bande du 11e', role: 'owner' }],
      isPending: false,
      isError: false,
      isLoading: false,
    }),
    useEvents: () => EMPTY,
    usePolls: () => EMPTY,
    useExpenses: () => EMPTY,
    useTodoLists: () => EMPTY,
    useActivityFeed: () => EMPTY,
    useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { HomeDashboard } from './HomeDashboard';

const GROUP_ID = '22222222-2222-4222-8222-222222222222';

// Mercredi 16 septembre 2026, 12 h UTC. Lundi et vendredi de la même semaine
// tombent donc tous deux dans la grille Lundi → Dimanche rendue par
// `WeekCalendar` — sinon les cases testées en sortiraient.
const NOW = new Date('2026-09-16T12:00:00.000Z');
const MONDAY = new Date('2026-09-14T19:00:00.000Z');
const FRIDAY = new Date('2026-09-18T19:00:00.000Z');

const PAST_UNANSWERED_TITLE = 'Barbecue de lundi';
const CONFIRMED_TITLE = 'Soiree jeux';

function buildWeekEvent(over: Partial<QueriesModule.HomeWeekEventItem> = {}) {
  return {
    id: 'week-1',
    title: 'Event de la semaine',
    startsAt: FRIDAY.toISOString(),
    location: null,
    groupId: GROUP_ID,
    groupName: 'La Bande du 11e',
    ...over,
  };
}

/** Le vendredi porte 6 événements : au-delà de l'ancien `limit 5`. */
const FRIDAY_TITLES = ['Apero', 'Concert', 'Ciné', 'Resto', 'Karaoke', 'After'];

const WEEK_EVENTS = [
  // Lundi : passé ET sans RSVP — invisible sous les deux anciens filtres.
  buildWeekEvent({
    id: 'past-unanswered',
    title: PAST_UNANSWERED_TITLE,
    startsAt: MONDAY.toISOString(),
  }),
  ...FRIDAY_TITLES.map((title, i) =>
    buildWeekEvent({ id: `friday-${i}`, title, startsAt: FRIDAY.toISOString() }),
  ),
];

/** Ce que la carte « Mes prochains events » doit continuer d'afficher :
 *  uniquement mes events confirmés à venir. */
const UPCOMING_EVENTS = [
  buildWeekEvent({ id: 'confirmed-1', title: CONFIRMED_TITLE, startsAt: FRIDAY.toISOString() }),
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

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomeDashboard onNavigate={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('HomeDashboard — le calendrier semaine montre la semaine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useAuth.setState({ user: TEST_USER, initializing: false });
    useHomeFeedMock.mockReturnValue({
      data: {
        pendingRsvps: [],
        unsettledExpenses: [],
        assignedTodos: [],
        upcomingEvents: UPCOMING_EVENTS,
        weekEvents: WEEK_EVENTS,
        pendingPolls: [],
        unreadByGroup: [],
      },
      isPending: false,
      isError: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    useHomeFeedMock.mockClear();
    vi.useRealTimers();
  });

  it('montre un événement passé de la semaine auquel je n’ai pas répondu', () => {
    renderHome();

    // `WeekDayCard` porte les titres de son jour en attribut `title`.
    expect(screen.getByTitle(PAST_UNANSWERED_TITLE)).toBeInTheDocument();
  });

  it('ne tronque pas un jour chargé à 5 événements', () => {
    renderHome();

    // Les 6 titres du vendredi sont joints par ' · ' dans le `title` de sa case.
    const friday = screen.getByTitle(FRIDAY_TITLES.join(' · '));
    expect(friday).toBeInTheDocument();
    // Et l'affordance annonce bien le reste : 3 pastilles + « +3 ».
    expect(within(friday).getByText('+3')).toBeInTheDocument();
  });

  it('laisse la carte « Mes prochains events » sur mes events confirmés', () => {
    renderHome();

    // Assertion scopée : le passé est légitimement présent dans le calendrier —
    // c'est l'objet du 1er test. Ce qui ne doit pas arriver, c'est qu'il
    // apparaisse dans une carte qui promet des events confirmés à venir.
    const card = screen.getByText('Mes prochains events').closest('section');
    if (!card) throw new Error('carte « Mes prochains events » introuvable');
    const scoped = within(card);
    expect(scoped.getByText(CONFIRMED_TITLE)).toBeInTheDocument();
    expect(scoped.queryByText(PAST_UNANSWERED_TITLE)).not.toBeInTheDocument();
  });
});
