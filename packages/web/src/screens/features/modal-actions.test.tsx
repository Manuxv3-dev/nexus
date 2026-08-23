/**
 * Migration des actions principales des modals orga vers le `Button` partagé
 * — MAN-112 Task 3 (RSVP, règlement d'une dépense, coche d'un todo, vote de
 * sondage).
 *
 * Les 4 contrôles partagent désormais le même socle (`active:scale-[0.96]`,
 * `focus-visible:shadow-focus`). L'option de vote de `PollModal` est le seul
 * cas qui neutralise des classes de base (`whitespace-nowrap`,
 * `font-semibold`, `disabled:opacity-55`) : c'est une ligne pleine largeur
 * avec barre de progression en fond, pas une action compacte. Ces overrides
 * sont verrouillés par un test dédié ci-dessous.
 */ import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';

import { EventModal } from './events/EventModal';
import { ExpenseModal } from './expenses/ExpenseModal';
import { PollModal } from './polls/PollModal';
import {
  buildEvent,
  buildExpense,
  buildPoll,
  buildTodoList,
  GROUP_ID,
  OTHER_USER_ID,
  USER_ID,
} from './testFixtures';
import { TodoListModal } from './todos/TodoListModal';

const rsvpMutateAsync = vi.fn().mockResolvedValue(undefined);
const settleMutateAsync = vi.fn().mockResolvedValue(undefined);
const updateTodoItemMutateAsync = vi.fn().mockResolvedValue(undefined);
const voteMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/queries', () => ({
  useGroupMembers: vi.fn(() => ({ data: [] })),
  useCreateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useEventRsvp: vi.fn(() => ({ mutateAsync: rsvpMutateAsync, isPending: false })),
  useCreatePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeletePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useVote: vi.fn(() => ({ mutateAsync: voteMutateAsync, isPending: false })),
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
  voteMutateAsync.mockClear();
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

describe('PollModal — vote migré vers Button (MAN-112 Task 3)', () => {
  it("l'option de vote expose les classes du Button affiné et déclenche le vote", async () => {
    useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
    const user = userEvent.setup();
    render(
      <PollModal mode="view" groupId={GROUP_ID} poll={buildPoll()} canEdit onClose={vi.fn()} />,
    );

    const option = screen.getByRole('button', { name: /Pizza/ });
    const classes = option.className.split(/\s+/);
    expect(classes).toContain('active:scale-[0.96]');
    expect(classes).toContain('focus-visible:shadow-focus');

    await user.click(option);
    expect(voteMutateAsync).toHaveBeenCalledWith({
      pollId: 'poll-1',
      optionId: 'opt-1',
      value: true,
    });
  });

  it('neutralise les classes de base incompatibles avec la ligne de vote pleine largeur', () => {
    render(
      <PollModal mode="view" groupId={GROUP_ID} poll={buildPoll()} canEdit onClose={vi.fn()} />,
    );
    const option = screen.getByRole('button', { name: /Pizza/ });
    const classes = option.className.split(/\s+/);

    // tailwind-merge doit avoir évincé les classes de base conflictuelles,
    // sinon la ligne (libellé + votants + compteur) casse ou se délave.
    expect(classes).not.toContain('whitespace-nowrap');
    expect(classes).not.toContain('font-semibold');
    expect(classes).toEqual(expect.arrayContaining(['whitespace-normal', 'font-normal']));

    // MAN-246 : l'override `disabled:opacity-100` a disparu avec le `disabled`
    // lui-même. `disabled:opacity-55` de la base survit donc, mais n'est plus
    // atteignable : une option de sondage ouvert n'est jamais désactivée, et un
    // sondage clos ne rend plus de bouton du tout (bloc MAN-246 en fin de
    // fichier). On assied la garantie sur l'état réel, pas sur la classe — la
    // réintroduire ferait silencieusement revenir le contrôle mort à opacité
    // pleine que MAN-246 supprime.
    expect(option).not.toBeDisabled();
  });

  it('un vote déjà exprimé reste affiché (état préservé) et reste actionnable', async () => {
    useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
    const user = userEvent.setup();
    render(
      <PollModal
        mode="view"
        groupId={GROUP_ID}
        poll={buildPoll({
          options: [
            { id: 'opt-1', pollId: 'poll-1', label: 'Pizza', position: 0, voters: [USER_ID] },
            { id: 'opt-2', pollId: 'poll-1', label: 'Sushi', position: 1, voters: [] },
          ],
        })}
        canEdit
        onClose={vi.fn()}
      />,
    );

    const option = screen.getByRole('button', { name: /Pizza/ });
    expect(option).toHaveAttribute('aria-pressed', 'true');

    // Re-cliquer retire le vote : la valeur envoyée dépend de l'état lu.
    await user.click(option);
    expect(voteMutateAsync).toHaveBeenCalledWith({
      pollId: 'poll-1',
      optionId: 'opt-1',
      value: false,
    });
  });
});

// MAN-246 point 5 — l'intention de MAN-112 (« une option de sondage clos reste
// un résultat à lire, pas un contrôle délavé ») était portée par un
// `<button disabled>` à opacité pleine : un contrôle sans plus aucune
// affordance d'inertie. L'option close n'est désormais plus un contrôle.
describe('PollModal — un sondage clos ne rend plus de contrôles (MAN-246)', () => {
  const CLOSED = { closesAt: new Date(Date.now() - 60_000).toISOString() };

  it("n'expose aucune option en tant que bouton une fois le sondage clos", () => {
    render(
      <PollModal
        mode="view"
        groupId={GROUP_ID}
        poll={buildPoll(CLOSED)}
        canEdit
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Pizza/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sushi/ })).not.toBeInTheDocument();
    // Le résultat reste lisible : c'est tout l'intérêt de ne pas le délaver.
    expect(screen.getByText('Pizza')).toBeInTheDocument();
    expect(screen.getByText('Sushi')).toBeInTheDocument();
  });

  it('ne déclenche aucun vote au clic sur une option close', async () => {
    useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
    const user = userEvent.setup();
    render(
      <PollModal
        mode="view"
        groupId={GROUP_ID}
        poll={buildPoll(CLOSED)}
        canEdit
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByText('Pizza'));

    expect(voteMutateAsync).not.toHaveBeenCalled();
  });

  it('conserve la trace du vote de l’utilisateur, que `aria-pressed` ne porte plus', () => {
    useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
    render(
      <PollModal
        mode="view"
        groupId={GROUP_ID}
        poll={buildPoll({
          ...CLOSED,
          options: [
            { id: 'opt-1', pollId: 'poll-1', label: 'Pizza', position: 0, voters: [USER_ID] },
            { id: 'opt-2', pollId: 'poll-1', label: 'Sushi', position: 1, voters: [] },
          ],
        })}
        canEdit
        onClose={vi.fn()}
      />,
    );

    // Sans ce libellé, l'information ne tiendrait plus qu'à la couleur de
    // bordure une fois le bouton retiré.
    expect(screen.getByText('Ton vote.')).toBeInTheDocument();
  });
});
