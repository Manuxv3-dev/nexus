/**
 * MAN-246 phase 5, point 2 — sous le point de rupture, le rail droit se replie
 * DANS le flux au lieu de rester une colonne de 340 px hors écran.
 *
 * Le bug : les 4 dashboards posaient `minmax(0, 1fr) 340px` en dur, et la seule
 * règle de repli existante (`.events-rail { display: none !important }`, dans
 * le `<style>` d'EventsDashboard) ciblait une classe que plus aucun élément ne
 * portait depuis que le rail est devenu un `<div style={rightRailStyle}>`.
 * Sur `MobileShell` → `DetailScreen`, la colonne n'était donc jamais repliée et
 * `QuickCreate` — seule affordance de création depuis que `FeatureShell` ne rend
 * plus de bouton d'action primaire (décision 2026-05-03) — sortait de l'écran,
 * pendant que l'état vide invitait à « créer le premier ».
 *
 * D'où les deux assertions par dashboard : la grille se replie, ET l'action de
 * création reste atteignable et actionnable. Masquer le rail aurait satisfait la
 * première en aggravant le vrai problème.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

import { RAIL_COLLAPSE_QUERY } from './DashboardLayout';
import { EventsDashboard } from './EventsDashboard';
import { ExpensesDashboard } from './ExpensesDashboard';
import { PollsDashboard } from './PollsDashboard';
import {
  buildEvent,
  buildExpense,
  buildPoll,
  buildTodoList,
  GROUP_ID,
  OTHER_USER_ID,
  USER_ID,
} from './testFixtures';
import { TodosDashboard } from './TodosDashboard';

const eventFixture = buildEvent();
const pollFixture = buildPoll();
const expenseFixture = buildExpense({ paidBy: OTHER_USER_ID });
const todoListFixture = buildTodoList();

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: vi.fn(() => ({ data: [], isLoading: false })),
    useGroupMembers: vi.fn(() => ({ data: [] })),

    useEvents: vi.fn((_groupId: string | undefined, filter: { when?: string }) => ({
      data: filter.when === 'past' ? [] : [eventFixture],
      isLoading: false,
    })),
    useEvent: vi.fn(() => ({ data: undefined })),
    useEventRsvp: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useCreateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useUpdateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),

    usePolls: vi.fn((_groupId: string | undefined, filter: { state?: string }) => ({
      data: filter.state === 'closed' ? [] : [pollFixture],
      isLoading: false,
    })),
    useVote: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useCreatePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeletePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),

    useExpenses: vi.fn(() => ({ data: [expenseFixture], isLoading: false })),
    useExpense: vi.fn(() => ({ data: undefined })),
    useSettleExpenseShare: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useCreateExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),

    useTodoLists: vi.fn(() => ({ data: [todoListFixture], isLoading: false })),
    useUpdateTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useCreateTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useAddTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  };
});

/**
 * Le stub global de `test/setup.ts` répond `matches: false` à toute query
 * (branche desktop). On le réinstalle localement pour piloter la seule query
 * qui nous intéresse — `beforeEach` d'un fichier de test s'exécute après celui
 * du setup global, donc celui-ci gagne.
 */
function setRailCollapsed(collapsed: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: collapsed && query === RAIL_COLLAPSE_QUERY,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(false),
  }));
}

const DASHBOARDS = [
  ['EventsDashboard', () => <EventsDashboard groupId={GROUP_ID} />, /Nouvel événement/],
  ['PollsDashboard', () => <PollsDashboard groupId={GROUP_ID} />, /Nouveau sondage/],
  ['ExpensesDashboard', () => <ExpensesDashboard groupId={GROUP_ID} />, /Nouvelle dépense/],
  ['TodosDashboard', () => <TodosDashboard groupId={GROUP_ID} />, /Nouvelle liste/],
] as const;

beforeEach(() => {
  useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('repli du rail sous le point de rupture (MAN-246 phase 5)', () => {
  it.each(DASHBOARDS)('%s : la grille passe sur une seule colonne', (_name, renderDashboard) => {
    setRailCollapsed(true);
    render(renderDashboard());

    expect(screen.getByTestId('dashboard-layout')).toHaveStyle({
      gridTemplateColumns: 'minmax(0, 1fr)',
    });
  });

  it.each(DASHBOARDS)(
    '%s : l’action de création reste atteignable et ouvre la modale',
    async (_name, renderDashboard, createLabel) => {
      setRailCollapsed(true);
      const user = userEvent.setup();
      render(renderDashboard());

      const createButton = screen.getByRole('button', { name: createLabel });
      expect(createButton).toBeEnabled();

      await user.click(createButton);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    },
  );

  it.each(DASHBOARDS)(
    '%s : au-dessus du point de rupture, la grille deux colonnes est inchangée',
    (_name, renderDashboard) => {
      setRailCollapsed(false);
      render(renderDashboard());

      expect(screen.getByTestId('dashboard-layout')).toHaveStyle({
        gridTemplateColumns: 'minmax(0, 1fr) 340px',
      });
    },
  );
});

describe('plus de règle CSS morte (MAN-246 phase 5)', () => {
  it('EventsDashboard n’injecte plus de sélecteur `.events-rail`', () => {
    setRailCollapsed(false);
    const { container } = render(<EventsDashboard groupId={GROUP_ID} />);

    const css = Array.from(container.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    expect(css).not.toContain('events-rail');
  });
});
