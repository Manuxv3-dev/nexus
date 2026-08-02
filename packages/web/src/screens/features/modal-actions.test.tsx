/**
 * Migration des actions principales des modals orga vers le `Button` partagé
 * — MAN-112 Task 3 (RSVP, règlement d'une dépense, coche d'un todo).
 *
 * Le vote de sondage (`PollModal`) n'est PAS migré ici : l'option de vote est
 * une ligne pleine largeur avec barre de progression en fond (son propre
 * contrôle, pas une action compacte) — un wrapping `Button` non vérifié
 * visuellement casserait sa mise en page flex (`justify-content: center`
 * imposé par les classes de base de `Button` écraserait le `space-between`
 * actuel du contenu). Cf. rapport final pour le détail.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';

import { EventModal } from './events/EventModal';
import { ExpenseModal } from './expenses/ExpenseModal';
import {
  buildEvent,
  buildExpense,
  buildTodoList,
  GROUP_ID,
  OTHER_USER_ID,
  USER_ID,
} from './testFixtures';
import { TodoListModal } from './todos/TodoListModal';

const rsvpMutateAsync = vi.fn().mockResolvedValue(undefined);
const settleMutateAsync = vi.fn().mockResolvedValue(undefined);
const updateTodoItemMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/queries', () => ({
  useGroupMembers: vi.fn(() => ({ data: [] })),
  useCreateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useEventRsvp: vi.fn(() => ({ mutateAsync: rsvpMutateAsync, isPending: false })),
  useCreateExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSettleExpenseShare: vi.fn(() => ({ mutateAsync: settleMutateAsync, isPending: false })),
  useCreateTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useAddTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateTodoItem: vi.fn(() => ({ mutateAsync: updateTodoItemMutateAsync, isPending: false })),
  useDeleteTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

beforeEach(() => {
  rsvpMutateAsync.mockClear();
  settleMutateAsync.mockClear();
  updateTodoItemMutateAsync.mockClear();
  useAuth.setState({ user: null });
});

describe('EventModal — RSVP migré vers Button (MAN-112 Task 3)', () => {
  it('le bouton RSVP "Oui" expose les classes du Button affiné', () => {
    render(
      <EventModal mode="view" groupId={GROUP_ID} event={buildEvent()} canEdit onClose={vi.fn()} />,
    );
    const button = screen.getByRole('button', { name: 'Oui' });
    const classes = button.className.split(/\s+/);
    expect(classes).toContain('active:scale-[0.96]');
    expect(classes).toContain('focus-visible:shadow-focus');
  });

  it('cliquer "Oui" déclenche le RSVP avec la bonne valeur', async () => {
    const user = userEvent.setup();
    render(
      <EventModal mode="view" groupId={GROUP_ID} event={buildEvent()} canEdit onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Oui' }));
    expect(rsvpMutateAsync).toHaveBeenCalledWith({ eventId: 'event-1', value: 'yes' });
  });

  it('un RSVP déjà répondu reste affiché (état préservé) et reste actionnable', async () => {
    useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
    const user = userEvent.setup();
    render(
      <EventModal
        mode="view"
        groupId={GROUP_ID}
        event={buildEvent({ rsvps: [{ userId: USER_ID, value: 'yes' }] })}
        canEdit
        onClose={vi.fn()}
      />,
    );
    // "Effacer" n'apparaît que si `myRsvp` est déjà résolu — preuve que l'état
    // existant est toujours lu correctement après la migration.
    expect(screen.getByText('Effacer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Peut-être' }));
    expect(rsvpMutateAsync).toHaveBeenCalledWith({ eventId: 'event-1', value: 'maybe' });
  });
});

describe('ExpenseModal — règlement de part migré vers Button (MAN-112 Task 3)', () => {
  it('le bouton de règlement expose les classes du Button affiné et déclenche le settle', async () => {
    useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
    const user = userEvent.setup();
    render(
      <ExpenseModal
        mode="view"
        groupId={GROUP_ID}
        expense={buildExpense()}
        canEdit
        onClose={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: /comme réglée/ });
    const classes = button.className.split(/\s+/);
    expect(classes).toContain('active:scale-[0.96]');

    await user.click(button);
    expect(settleMutateAsync).toHaveBeenCalledWith({ expenseId: 'expense-1', settled: true });
  });

  it('une part déjà réglée reste affichée comme telle (état préservé) et reste actionnable', async () => {
    useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
    const user = userEvent.setup();
    render(
      <ExpenseModal
        mode="view"
        groupId={GROUP_ID}
        expense={buildExpense({
          shares: [
            {
              expenseId: 'expense-1',
              userId: USER_ID,
              shareCents: 2000,
              isSettled: true,
              settledAt: new Date().toISOString(),
            },
            {
              expenseId: 'expense-1',
              userId: OTHER_USER_ID,
              shareCents: 2000,
              isSettled: false,
              settledAt: null,
            },
          ],
        })}
        canEdit
        onClose={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Annuler le règlement' });
    await user.click(button);
    expect(settleMutateAsync).toHaveBeenCalledWith({ expenseId: 'expense-1', settled: false });
  });
});

describe('TodoListModal — coche d’item migrée vers Button (MAN-112 Task 3)', () => {
  it('le bouton de coche expose les classes du Button affiné et déclenche le toggle', async () => {
    const user = userEvent.setup();
    render(
      <TodoListModal
        mode="view"
        groupId={GROUP_ID}
        list={buildTodoList()}
        canEdit
        onClose={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Cocher Pain' });
    const classes = button.className.split(/\s+/);
    expect(classes).toContain('active:scale-[0.96]');

    await user.click(button);
    expect(updateTodoItemMutateAsync).toHaveBeenCalledWith({
      itemId: 'item-1',
      listId: 'list-1',
      groupId: GROUP_ID,
      done: true,
    });
  });

  it('un item déjà coché reste affiché comme tel (état préservé) et reste actionnable', async () => {
    const user = userEvent.setup();
    render(
      <TodoListModal
        mode="view"
        groupId={GROUP_ID}
        list={buildTodoList()}
        canEdit
        onClose={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Décocher Lait (déjà cochée)' });
    await user.click(button);
    expect(updateTodoItemMutateAsync).toHaveBeenCalledWith({
      itemId: 'item-2',
      listId: 'list-1',
      groupId: GROUP_ID,
      done: false,
    });
  });
});
