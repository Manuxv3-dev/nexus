/**
 * Quand le serveur refuse un assigné ou un porteur de part qui n'est plus
 * membre (`VALIDATION_ERROR` / `user_not_member`), la modale le dit en
 * français et remet la liste des membres à jour (cf. ticket 77950250).
 *
 * Le cas réel : le select d'assignés et les cases de participants sont
 * alimentés par `['group-members', groupId]`. Un membre part pendant que la
 * modale est ouverte — entre le `member:removed` et le refetch, ou si le WS
 * est tombé, le formulaire propose encore quelqu'un que le serveur refuse.
 * Avant, l'écran affichait « Validation error » : la chaîne backend, en
 * anglais, sans dire ni qui ni pourquoi.
 *
 * Fichier transverse aux deux modales, comme `modal-actions.test.tsx` : c'est
 * la même règle sur deux surfaces, et c'est sa cohérence qu'on verrouille.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { ExpenseModal } from './expenses/ExpenseModal';
import { buildTodoList, GROUP_ID } from './testFixtures';
import { TodoListModal } from './todos/TodoListModal';

const MEMBERS = [
  { userId: 'u-manu', displayName: 'Manu' },
  { userId: 'u-lea', displayName: 'Léa' },
];

const refetchMembers = vi.fn();
const updateTodoItemMutateAsync = vi.fn();
const createExpenseMutateAsync = vi.fn();

vi.mock('@/lib/queries', () => ({
  useGroupMembers: vi.fn(() => ({ data: MEMBERS, refetch: refetchMembers })),
  useCreateTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useAddTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateTodoItem: vi.fn(() => ({ mutateAsync: updateTodoItemMutateAsync, isPending: false })),
  useDeleteTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateExpense: vi.fn(() => ({ mutateAsync: createExpenseMutateAsync, isPending: false })),
  useDeleteExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSettleExpenseShare: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

/** Ce que renvoie `assertAllMembers` côté backend pour `userId`. */
function userNotMember(userId: string): ApiError {
  return new ApiError(400, {
    code: 'VALIDATION_ERROR',
    message: 'Validation error',
    details: { reason: 'user_not_member', userId },
  });
}

beforeEach(() => {
  refetchMembers.mockClear();
  updateTodoItemMutateAsync.mockReset();
  createExpenseMutateAsync.mockReset();
  useAuth.setState({
    user: {
      id: 'u-manu',
      email: 'manu@example.com',
      displayName: 'Manu',
      avatarUrl: null,
      themePreference: null,
      landingPreference: 'home',
      onboardingStep: null,
      onboardingCompletedAt: null,
      createdAt: new Date().toISOString(),
    },
    initializing: false,
  });
});

describe('TodoListModal — assigner quelqu’un qui n’est plus membre', () => {
  it('affiche qui a quitté le groupe et rafraîchit la liste des membres', async () => {
    const user = userEvent.setup();
    updateTodoItemMutateAsync.mockRejectedValueOnce(userNotMember('u-lea'));
    render(
      <TodoListModal
        mode="view"
        groupId={GROUP_ID}
        list={buildTodoList()}
        canEdit
        onClose={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Assigner « Pain » à' }),
      'u-lea',
    );

    expect(await screen.findByText('Léa ne fait plus partie du groupe.')).toBeInTheDocument();
    expect(screen.queryByText('Validation error')).not.toBeInTheDocument();
    // Le select se remet à jour sans attendre le prochain refetch.
    expect(refetchMembers).toHaveBeenCalledTimes(1);
  });

  it('laisse les autres erreurs telles quelles', async () => {
    const user = userEvent.setup();
    updateTodoItemMutateAsync.mockRejectedValueOnce(new Error('Erreur réseau'));
    render(
      <TodoListModal
        mode="view"
        groupId={GROUP_ID}
        list={buildTodoList()}
        canEdit
        onClose={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Assigner « Pain » à' }),
      'u-lea',
    );

    expect(await screen.findByText('Erreur réseau')).toBeInTheDocument();
    expect(refetchMembers).not.toHaveBeenCalled();
  });
});

describe('ExpenseModal — un participant qui n’est plus membre', () => {
  it('affiche qui a quitté le groupe et rafraîchit la liste des membres', async () => {
    const user = userEvent.setup();
    createExpenseMutateAsync.mockRejectedValueOnce(userNotMember('u-lea'));
    render(<ExpenseModal mode="create" groupId={GROUP_ID} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Description'), 'Resto');
    await user.type(screen.getByLabelText('Montant (EUR)'), '42');
    // Payé par Manu (défaut : l'utilisateur courant), parts Manu + Léa (défaut :
    // tous les membres cochés). Léa est celle que le serveur refuse.
    await user.click(screen.getByRole('button', { name: 'Créer' }));

    expect(await screen.findByText('Léa ne fait plus partie du groupe.')).toBeInTheDocument();
    expect(refetchMembers).toHaveBeenCalledTimes(1);
  });
});
