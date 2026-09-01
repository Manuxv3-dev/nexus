/**
 * Le calendrier semaine du GroupHome doit montrer les jours déjà écoulés de la
 * semaine en cours.
 *
 * `WeekCalendar` affiche Lundi → Dimanche de la semaine courante, mais son
 * appelant ne lui passait que `useEvents(group.id, { when: 'upcoming' })` : un
 * mercredi, les cases Lundi et Mardi étaient vides par construction, même si
 * un événement s'y était tenu. Le composant ne pouvait pas afficher la moitié
 * de la semaine qu'il dessine.
 *
 * Le piège de la correction : `eventsQ` alimente aussi le hero « à venir » et
 * la liste des prochains événements. Basculer la requête en `all` sans
 * redécouper aurait fait compter les événements passés comme à venir. D'où le
 * second test, qui verrouille cette moitié-là.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

import { buildEvent } from '../features/testFixtures';

const { useEventsMock } = vi.hoisted(() => ({ useEventsMock: vi.fn() }));

const EMPTY = { data: [], isPending: false, isError: false, isLoading: false };

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useEvents: useEventsMock,
    usePolls: () => EMPTY,
    useExpenses: () => EMPTY,
    useTodoLists: () => EMPTY,
    useActivityFeed: () => EMPTY,
    useGroupMembers: () => ({ data: [], isPending: false, isError: false }),
  };
});

import { GroupHomeDashboard } from './GroupHomeDashboard';

// Mardi 15 septembre 2026, 14 h locale : « hier » (lundi) tombe dans la même
// semaine Lundi → Dimanche, sinon la case testée sortirait de la grille.
const NOW = new Date('2026-09-15T12:00:00.000Z');
const YESTERDAY = new Date('2026-09-14T19:00:00.000Z');
const TOMORROW = new Date('2026-09-16T19:00:00.000Z');

const PAST_TITLE = 'Barbecue de lundi';
const FUTURE_TITLE = 'Soiree jeux';

const ALL_EVENTS = [
  buildEvent({ id: 'past-1', title: PAST_TITLE, startsAt: YESTERDAY.toISOString() }),
  buildEvent({ id: 'future-1', title: FUTURE_TITLE, startsAt: TOMORROW.toISOString() }),
];

const TEST_GROUP: QueriesModule.Group = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'La Bande du 11e',
  createdBy: '11111111-1111-4111-8111-111111111111',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  role: 'owner',
};

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
      <GroupHomeDashboard group={TEST_GROUP} onNavigate={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('GroupHomeDashboard — calendrier semaine', () => {
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

  it('montre un événement passé de la semaine en cours', () => {
    renderDashboard();

    // `WeekDayCard` porte les titres du jour en attribut `title`.
    expect(screen.getByTitle(PAST_TITLE)).toBeInTheDocument();
  });

  it('continue de montrer les événements à venir', () => {
    renderDashboard();

    expect(screen.getByTitle(FUTURE_TITLE)).toBeInTheDocument();
  });

  it("n'a pas fait déborder le passé dans la carte « Prochains events »", () => {
    renderDashboard();

    // Assertion scopée : le titre du passé est légitimement présent ailleurs —
    // c'est tout l'objet des deux tests précédents. Ce qui ne doit pas arriver,
    // c'est qu'il apparaisse dans une carte qui promet des événements à venir.
    // `Card` est une <section> ; le titre vit dans un <div> de son <header>.
    const card = screen.getByText('Prochains events').closest('section');
    // `throw` plutôt qu'une assertion non-null : narrowing réel pour TS, et le
    // test échoue avec un message parlant si la structure de `Card` bouge.
    if (!card) throw new Error('carte « Prochains events » introuvable');
    const scoped = within(card);
    expect(scoped.getByText(FUTURE_TITLE)).toBeInTheDocument();
    expect(scoped.queryByText(PAST_TITLE)).not.toBeInTheDocument();
  });
});
