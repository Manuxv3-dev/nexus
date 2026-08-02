/**
 * Test d'acceptation du slice MAN-112 Phase 3 : ouverture d'un panel orga →
 * animation d'entrée (Task 1) + action principale migrée fonctionnelle
 * (Task 3), paramétré sur les 4 dashboards (events/polls/expenses/todos).
 *
 * Référence de pattern : components/ui/Button.test.tsx (MAN-110 Task 4).
 */ import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

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

const rsvpMutateAsync = vi.fn().mockResolvedValue(undefined);
const voteMutateAsync = vi.fn().mockResolvedValue(undefined);
const settleMutateAsync = vi.fn().mockResolvedValue(undefined);
const updateTodoItemMutateAsync = vi.fn().mockResolvedValue(undefined);

const eventFixture = buildEvent();
const pollFixture = buildPoll();
const expenseFixture = buildExpense({ paidBy: OTHER_USER_ID });
const todoListFixture = buildTodoList();

vi.mock('@/lib/queries', async () => {
  const actual = await vi.importActual<typeof QueriesModule>('@/lib/queries');
  return {
    ...actual,
    useGroups: vi.fn(() => ({ data: [], isLoading: false })),
    useGroupMembers: vi.fn(() => ({ data: [] })),

    // Events
    useEvents: vi.fn((_groupId: string | undefined, filter: { when?: string }) => ({
      data: filter.when === 'past' ? [] : [eventFixture],
      isLoading: false,
    })),
    useEvent: vi.fn(() => ({ data: undefined })),
    useEventRsvp: vi.fn(() => ({ mutateAsync: rsvpMutateAsync, isPending: false })),
    useCreateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useUpdateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),

    // Polls
    usePolls: vi.fn((_groupId: string | undefined, filter: { state?: string }) => ({
      data: filter.state === 'closed' ? [] : [pollFixture],
      isLoading: false,
    })),
    useVote: vi.fn(() => ({ mutateAsync: voteMutateAsync, isPending: false })),
    useCreatePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeletePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),

    // Expenses
    useExpenses: vi.fn(() => ({ data: [expenseFixture], isLoading: false })),
    useExpense: vi.fn(() => ({ data: undefined })),
    useSettleExpenseShare: vi.fn(() => ({ mutateAsync: settleMutateAsync, isPending: false })),
    useCreateExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),

    // Todos
    useTodoLists: vi.fn(() => ({ data: [todoListFixture], isLoading: false })),
    useUpdateTodoItem: vi.fn(() => ({ mutateAsync: updateTodoItemMutateAsync, isPending: false })),
    useCreateTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useAddTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  };
});

beforeEach(() => {
  rsvpMutateAsync.mockClear();
  voteMutateAsync.mockClear();
  settleMutateAsync.mockClear();
  updateTodoItemMutateAsync.mockClear();
  useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
});

describe('acceptation — animation d’entrée du panel (MAN-112 Task 1, les 4 dashboards)', () => {
  it.each([
    ['EventsDashboard', () => render(<EventsDashboard groupId={GROUP_ID} />)],
    ['PollsDashboard', () => render(<PollsDashboard groupId={GROUP_ID} />)],
    ['ExpensesDashboard', () => render(<ExpensesDashboard groupId={GROUP_ID} />)],
    ['TodosDashboard', () => render(<TodosDashboard groupId={GROUP_ID} />)],
  ] as const)('%s anime son entrée via FeatureShell', (_name, renderDashboard) => {
    const { container } = renderDashboard();
    const root = container.firstElementChild;
    expect(root).toHaveClass('animate-in');
    expect(root).toHaveClass('fade-in');
  });
});

describe('acceptation — panel → action principale migrée fonctionnelle (MAN-112 Task 3)', () => {
  it('EventsDashboard : ouvrir le prochain événement puis RSVP via le Button migré', async () => {
    const user = userEvent.setup();
    render(<EventsDashboard groupId={GROUP_ID} />);

    await user.click(screen.getByRole('button', { name: /Voir l'événement/ }));
    const dialog = screen.getByRole('dialog');
    const rsvpButton = within(dialog).getByRole('button', { name: 'Oui' });
    expect(rsvpButton.className.split(/\s+/)).toContain('active:scale-[0.96]');

    await user.click(rsvpButton);
    expect(rsvpMutateAsync).toHaveBeenCalledWith({ eventId: eventFixture.id, value: 'yes' });
  });

  it('ExpensesDashboard : ouvrir une dépense puis régler sa part via le Button migré', async () => {
    const user = userEvent.setup();
    render(<ExpensesDashboard groupId={GROUP_ID} />);

    await user.click(screen.getByRole('button', { name: new RegExp(expenseFixture.description) }));
    const dialog = screen.getByRole('dialog');
    const settleButton = within(dialog).getByRole('button', { name: /comme réglée/ });
    expect(settleButton.className.split(/\s+/)).toContain('active:scale-[0.96]');

    await user.click(settleButton);
    expect(settleMutateAsync).toHaveBeenCalledWith({ expenseId: expenseFixture.id, settled: true });
  });

  it('TodosDashboard : ouvrir une liste puis cocher un item via le Button migré', async () => {
    const user = userEvent.setup();
    render(<TodosDashboard groupId={GROUP_ID} />);

    await user.click(screen.getByRole('button', { name: new RegExp(todoListFixture.title) }));
    const dialog = screen.getByRole('dialog');
    const checkButton = within(dialog).getByRole('button', { name: 'Cocher Pain' });
    expect(checkButton.className.split(/\s+/)).toContain('active:scale-[0.96]');

    await user.click(checkButton);
    expect(updateTodoItemMutateAsync).toHaveBeenCalledWith({
      itemId: 'item-1',
      listId: todoListFixture.id,
      groupId: GROUP_ID,
      done: true,
    });
  });

  it('PollsDashboard : ouvrir un sondage puis voter via le Button migré', async () => {
    const user = userEvent.setup();
    render(<PollsDashboard groupId={GROUP_ID} />);

    await user.click(screen.getByRole('button', { name: /Voter/ }));
    const dialog = screen.getByRole('dialog');
    const optionButton = within(dialog).getByRole('button', { name: /Pizza/ });
    expect(optionButton.className.split(/\s+/)).toContain('active:scale-[0.96]');

    await user.click(optionButton);
    expect(voteMutateAsync).toHaveBeenCalledWith({
      pollId: pollFixture.id,
      optionId: 'opt-1',
      value: true,
    });
  });
});
