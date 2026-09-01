/**
 * Cliquer un jour du calendrier semaine doit remonter le JOUR, pas un seul
 * événement.
 *
 * `WeekDayCard` affiche jusqu'à 3 pastilles et un « +N » — l'affordance promet
 * le contenu du jour. Le clic n'en ouvrait qu'un :
 *
 * ```tsx
 * onClick={() => { if (firstEvent && onEventClick) onEventClick(firstEvent); }}
 * ```
 *
 * Depuis la PR #73 le calendrier reçoit aussi les événements passés, donc ce
 * « premier » peut désormais être un événement déjà écoulé — l'arbitraire est
 * devenu visible.
 *
 * Le canal réutilisé est celui de MAN-246 : `pendingOpen` porte déjà `'item'`
 * et `'create'`, il porte maintenant `'date'`. Ce fichier couvre la tranche
 * entière, de l'émetteur (`WeekCalendar`) au consommateur (`EventsDashboard`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';
import { EventsDashboard } from '@/screens/features/EventsDashboard';

import { buildEvent } from '../features/testFixtures';

import { GroupHomeDashboard } from './GroupHomeDashboard';
import { WeekCalendar } from './WeekCalendar';

const { useEventsMock } = vi.hoisted(() => ({ useEventsMock: vi.fn() }));

const EMPTY = { data: [], isPending: false, isError: false, isLoading: false };

/** Mardi 15 septembre 2026, 14 h à Paris — le 14, 15 et 16 tiennent dans la
 *  même grille Lundi → Dimanche. */
const NOW = new Date('2026-09-15T12:00:00.000Z');

const TEST_GROUP: QueriesModule.Group = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'La Bande du 11e',
  createdBy: '11111111-1111-4111-8111-111111111111',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  role: 'owner',
};

const TEST_USER = {
  id: TEST_GROUP.createdBy,
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: NOW.toISOString(),
};

/** Trois événements le MÊME jour — le cas que le clic escamotait. */
const APERO = buildEvent({
  id: 'evt-1',
  title: 'Apero',
  startsAt: '2026-09-15T16:00:00.000Z',
  groupId: TEST_GROUP.id,
});
const CINE = buildEvent({
  id: 'evt-2',
  title: 'Cine',
  startsAt: '2026-09-15T18:00:00.000Z',
  groupId: TEST_GROUP.id,
});
const RESTO = buildEvent({
  id: 'evt-3',
  title: 'Resto',
  startsAt: '2026-09-15T20:00:00.000Z',
  groupId: TEST_GROUP.id,
});
const SAME_DAY = [APERO, CINE, RESTO];

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [TEST_GROUP], isPending: false, isError: false, isLoading: false }),
    useEvents: useEventsMock,
    useEvent: () => ({ data: undefined }),
    usePolls: () => EMPTY,
    useExpenses: () => EMPTY,
    useTodoLists: () => EMPTY,
    useActivityFeed: () => EMPTY,
    useGroupMembers: () => ({ data: [], isPending: false, isError: false }),
  };
});

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useAuth.setState({ user: TEST_USER, initializing: false });
  useEventsMock.mockImplementation(
    (_groupId: string | undefined, filter?: { when?: 'upcoming' | 'past' | 'all' }) => {
      const when = filter?.when ?? 'all';
      const now = Date.now();
      const data = SAME_DAY.filter((e) => {
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

describe('WeekCalendar — le clic remonte le jour', () => {
  /** `WeekDayCard` porte les titres du jour joints par « · » en `title`. */
  const DAY_TITLE = 'Apero · Cine · Resto';

  it('remonte les N événements du jour, pas seulement le premier', () => {
    const onDayClick = vi.fn();
    render(<WeekCalendar events={SAME_DAY} onDayClick={onDayClick} />);

    fireEvent.click(screen.getByTitle(DAY_TITLE));

    expect(onDayClick).toHaveBeenCalledTimes(1);
    const [day] = onDayClick.mock.calls[0] as [{ date: Date; events: typeof SAME_DAY }];
    expect(day.events.map((e) => e.id)).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(day.date.getDate()).toBe(15);
  });

  it('laisse un jour sans événement non cliquable', () => {
    const onDayClick = vi.fn();
    render(<WeekCalendar events={SAME_DAY} onDayClick={onDayClick} />);

    // Le lundi 14 ne porte rien : son `title` retombe sur la date longue.
    const empty = screen.getByTitle(/lundi/i);
    expect(empty).toBeDisabled();
  });
});

describe('GroupHomeDashboard — le clic sur un jour vise la date', () => {
  it('émet la pane événements avec le jour ISO, pas un sourceId', () => {
    const onNavigate = vi.fn();
    withClient(<GroupHomeDashboard group={TEST_GROUP} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTitle('Apero · Cine · Resto'));

    expect(onNavigate).toHaveBeenCalledWith({ pane: 'event', date: '2026-09-15' });
  });
});

describe('EventsDashboard — consomme une intention de date', () => {
  it('présélectionne le jour et liste tout ce qu’il porte', () => {
    const onConsumeOpen = vi.fn();
    withClient(
      <EventsDashboard
        groupId={TEST_GROUP.id}
        openDate="2026-09-15"
        onConsumeOpen={onConsumeOpen}
      />,
    );

    // Le chip de jour sélectionné apparaît…
    expect(screen.getByText(/Jour 15/)).toBeInTheDocument();
    // …et la liste est bien celle DU JOUR, avec ses trois événements.
    // On assied l'assertion sur l'en-tête de section plutôt que sur les titres
    // d'événement : « Apero » apparaît aussi dans le hero « prochain
    // événement », donc le chercher au texte matcherait deux fois sans rien
    // dire de la liste.
    const heading = screen.getByRole('heading', { name: /Événements du 15/ });
    // Ni `as HTMLElement` ni `!` : `non-nullable-type-assertion-style` interdit
    // le premier, `no-non-null-assertion` le second. Un vrai narrowing satisfait
    // les deux et donne un échec lisible si la structure change.
    const section = heading.parentElement;
    if (!section) throw new Error("l'en-tête de section n'a pas de parent");
    expect(within(section).getByText('3')).toBeInTheDocument();
    // Consommée une seule fois, sinon la sélection se réarmerait à chaque
    // re-render et l'utilisateur ne pourrait plus en changer.
    expect(onConsumeOpen).toHaveBeenCalledTimes(1);
  });

  it('ne présélectionne rien sans intention', () => {
    const onConsumeOpen = vi.fn();
    withClient(<EventsDashboard groupId={TEST_GROUP.id} onConsumeOpen={onConsumeOpen} />);

    expect(screen.queryByText(/Jour 15/)).not.toBeInTheDocument();
    expect(onConsumeOpen).not.toHaveBeenCalled();
  });
});
