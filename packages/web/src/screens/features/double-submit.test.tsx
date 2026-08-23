/**
 * MAN-246 point 4 — double-soumission.
 *
 * Deux surfaces acceptaient un second déclenchement pendant que le premier
 * était encore en vol :
 *
 *  - `ExpenseModal` : « Marquer ma part comme réglée » ne recevait aucun
 *    `disabled`. `busy` était pourtant calculé et incluait bien
 *    `settle.isPending` — il n'était simplement jamais passé à ce bouton-là.
 *    Deux clics = deux `PATCH` concurrents portant un toggle inversé, donc un
 *    état final qui dépend de l'ordre d'arrivée des réponses.
 *  - `TodosDashboard` (héros « Tes tâches en cours ») : la case n'était ni
 *    désactivée pendant la mutation ni cochée en optimiste — elle restait
 *    vide jusqu'au refetch, ce qui *invite* au second clic.
 *
 * Le troisième site du point 4 (les 12 cartes de connexion qui partagent une
 * seule instance de mutation) vit dans `screens/settings/SettingsScreen.test.tsx`,
 * au plus près de son écran.
 *
 * Fichier séparé de `modal-actions.test.tsx` : celui-ci fige `isPending: false`
 * pour toutes les mutations, ce qui est exactement l'état qu'on doit pouvoir
 * piloter ici.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

import { ExpenseModal } from './expenses/ExpenseModal';
import { buildExpense, buildTodoList, GROUP_ID, OTHER_USER_ID, USER_ID } from './testFixtures';
import { TodosDashboard } from './TodosDashboard';

const settleMutateAsync = vi.fn().mockResolvedValue(undefined);
/** Piloté par test : `useSettleExpenseShare` lit `.isPending` à chaque rendu. */
const settleState = { isPending: false };

const updateTodoItemMutateAsync = vi.fn().mockResolvedValue(undefined);

const NOW = new Date().toISOString();

/**
 * Le héros « Tes tâches en cours » ne collecte que les items assignés à
 * l'utilisateur ET non faits (`TodosDashboard.tsx`, construction de
 * `myPendingItems`). Le fixture par défaut a `assigneeId: null` — il ne
 * produirait aucun héros.
 */
const todoListFixture = buildTodoList({
  items: [
    {
      id: 'item-1',
      listId: 'list-1',
      text: 'Pain',
      done: false,
      assigneeId: USER_ID,
      position: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'item-2',
      listId: 'list-1',
      text: 'Beurre',
      done: false,
      assigneeId: USER_ID,
      position: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
});

vi.mock('@/lib/queries', async () => {
  const actual = await vi.importActual<typeof QueriesModule>('@/lib/queries');
  return {
    ...actual,
    useGroups: vi.fn(() => ({ data: [], isLoading: false })),
    useGroupMembers: vi.fn(() => ({ data: [] })),
    useTodoLists: vi.fn(() => ({ data: [todoListFixture], isLoading: false })),
    useUpdateTodoItem: vi.fn(() => ({
      mutateAsync: updateTodoItemMutateAsync,
      isPending: false,
    })),
    useCreateExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useDeleteExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useSettleExpenseShare: vi.fn(() => ({
      mutateAsync: settleMutateAsync,
      isPending: settleState.isPending,
    })),
  };
});

beforeEach(() => {
  settleMutateAsync.mockClear();
  settleMutateAsync.mockResolvedValue(undefined);
  settleState.isPending = false;
  updateTodoItemMutateAsync.mockClear();
  updateTodoItemMutateAsync.mockResolvedValue(undefined);
  useAuth.setState({ user: { id: USER_ID } as ReturnType<typeof useAuth.getState>['user'] });
});

/** L'expense doit être payée par quelqu'un d'autre pour que le bouton existe. */
function renderExpenseModal() {
  return render(
    <ExpenseModal
      mode="view"
      groupId={GROUP_ID}
      expense={buildExpense({ paidBy: OTHER_USER_ID })}
      canEdit
      onClose={vi.fn()}
    />,
  );
}

const SETTLE_LABEL = /Marquer ma part/;

describe('ExpenseModal — « Marquer ma part comme réglée » (MAN-246)', () => {
  it('désactive le bouton pendant que le règlement est en vol', () => {
    settleState.isPending = true;
    renderExpenseModal();

    expect(screen.getByRole('button', { name: SETTLE_LABEL })).toBeDisabled();
  });

  it('reste actionnable au repos', () => {
    renderExpenseModal();

    expect(screen.getByRole('button', { name: SETTLE_LABEL })).toBeEnabled();
  });

  it("n'envoie rien de plus si l'on reclique pendant que le règlement est en vol", async () => {
    // `isPending` est figé par le mock de `useSettleExpenseShare` : on ne peut
    // pas observer la transition repos → en-vol dans un même rendu. On prouve
    // donc directement ce qui bloquait le second PATCH — le bouton n'accepte
    // plus le clic tant que la mutation est en vol.
    settleState.isPending = true;
    const user = userEvent.setup();
    renderExpenseModal();

    await user.click(screen.getByRole('button', { name: SETTLE_LABEL }));

    expect(settleMutateAsync).not.toHaveBeenCalled();
  });
});

describe('TodosDashboard — case du héros « Tes tâches en cours » (MAN-246)', () => {
  /**
   * Nom exact, pas une regex : la carte de liste est un seul gros bouton dont
   * le nom accessible concatène tout son contenu — « Courses2 pour toi0 / 2
   * (0%)PainBeurre » — donc un `/Pain/` matche deux éléments.
   */
  function heroCheckbox(text: string) {
    return screen.getByRole('button', { name: `Cocher ${text}` });
  }

  it("n'envoie qu'un seul PATCH sur deux clics rapides", async () => {
    updateTodoItemMutateAsync.mockReturnValue(
      new Promise(() => {
        /* jamais résolue : fige la fenêtre « mutation en vol » */
      }),
    );
    const user = userEvent.setup();
    render(<TodosDashboard groupId={GROUP_ID} />);

    const box = heroCheckbox('Pain');
    await user.click(box);
    await user.click(box);

    expect(updateTodoItemMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('ne gèle que la case cliquée, pas les autres lignes du héros', async () => {
    // Régression attendue si l'état « en cours » est porté par la seule
    // instance de mutation (`updateItem.isPending`), partagée par les 5
    // lignes — même défaut que les 12 cartes de connexion des Réglages.
    updateTodoItemMutateAsync.mockReturnValue(
      new Promise(() => {
        /* jamais résolue : fige la fenêtre « mutation en vol » */
      }),
    );
    const user = userEvent.setup();
    render(<TodosDashboard groupId={GROUP_ID} />);

    await user.click(heroCheckbox('Pain'));

    await waitFor(() => expect(heroCheckbox('Pain')).toBeDisabled());
    expect(heroCheckbox('Beurre')).toBeEnabled();
  });

  it('coche la case en optimiste, sans attendre le refetch', async () => {
    updateTodoItemMutateAsync.mockReturnValue(
      new Promise(() => {
        /* jamais résolue : fige la fenêtre « mutation en vol » */
      }),
    );
    const user = userEvent.setup();
    render(<TodosDashboard groupId={GROUP_ID} />);

    const box = heroCheckbox('Pain');
    expect(box).toHaveAttribute('aria-pressed', 'false');

    await user.click(box);

    // Sans ce retour immédiat, la case reste vide jusqu'au refetch : c'est ce
    // silence qui invitait au second clic.
    await waitFor(() => expect(heroCheckbox('Pain')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('envoie done: true — le héros ne liste que des tâches non faites', async () => {
    const user = userEvent.setup();
    render(<TodosDashboard groupId={GROUP_ID} />);

    await user.click(heroCheckbox('Pain'));

    // Pas un toggle, et c'est volontaire : `myPendingItems` filtre sur
    // `!i.done`, donc aucun item coché ne peut apparaître ici. Un « décocher »
    // serait une branche inatteignable.
    expect(updateTodoItemMutateAsync).toHaveBeenCalledWith({
      itemId: 'item-1',
      listId: 'list-1',
      groupId: GROUP_ID,
      done: true,
    });
  });
});
