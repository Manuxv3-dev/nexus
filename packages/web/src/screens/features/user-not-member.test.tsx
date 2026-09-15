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

const MANU = { userId: 'u-manu', displayName: 'Manu' };
const LEA = { userId: 'u-lea', displayName: 'Léa' };
const MEMBERS = [MANU, LEA];

// Ce que `useGroupMembers` sert : mutable pour que `refetch` puisse simuler
// le départ de Léa (la liste passe à `[Manu]` au rendu suivant), comme le
// ferait le vrai refetch. Référence stable entre deux rendus, sinon l'effet
// de réconciliation de `ExpenseModal` tournerait en boucle sur un tableau
// neuf à chaque appel.
let membersState: { userId: string; displayName: string }[] = MEMBERS;
const refetchMembers = vi.fn();
const updateTodoItemMutateAsync = vi.fn();
/** Ce que `ExpenseModal.handleSave` envoie — la partie qu'on asserte. */
interface SubmittedExpense {
  paidBy: string;
  shares: { userId: string; shareCents: number }[];
}
const createExpenseMutateAsync = vi.fn<(input: SubmittedExpense) => Promise<void>>();

vi.mock('@/lib/queries', () => ({
  useGroupMembers: vi.fn(() => ({ data: membersState, refetch: refetchMembers })),
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
  membersState = MEMBERS;
  refetchMembers.mockReset();
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
    // La prémisse du test : c'est bien la liste périmée qui a mis Léa dans
    // les parts envoyées.
    const submitted = createExpenseMutateAsync.mock.calls[0]?.[0];
    expect(submitted?.shares.map((s) => s.userId)).toContain('u-lea');
  });

  it('après le refus, le formulaire lâche la personne partie et le second envoi passe', async () => {
    // Le refetch fait disparaître la case de Léa — mais sans réconciliation,
    // `participantIds` la gardait : chaque « Créer » repartait avec sa part et
    // reprenait le même 400. La seule sortie était de fermer la modale (cf.
    // 26123073). Le vrai refetch remplace la liste au rendu suivant ; on fait
    // pareil.
    const user = userEvent.setup();
    const onClose = vi.fn();
    refetchMembers.mockImplementation(() => {
      membersState = [MANU];
      return Promise.resolve();
    });
    createExpenseMutateAsync
      .mockRejectedValueOnce(userNotMember('u-lea'))
      .mockResolvedValueOnce(undefined);
    render(<ExpenseModal mode="create" groupId={GROUP_ID} onClose={onClose} />);

    await user.type(screen.getByLabelText('Description'), 'Resto');
    await user.type(screen.getByLabelText('Montant (EUR)'), '42');
    await user.click(screen.getByRole('button', { name: 'Créer' }));
    expect(await screen.findByText('Léa ne fait plus partie du groupe.')).toBeInTheDocument();

    // La liste est à jour, la légende aussi — et Léa n'a plus de case.
    expect(screen.getByRole('group', { name: 'Participants (1/1)' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Léa')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Créer' }));

    // Le second envoi ne porte plus que Manu, avec toute la somme.
    const last = createExpenseMutateAsync.mock.lastCall?.[0];
    expect(last?.paidBy).toBe('u-manu');
    expect(last?.shares).toEqual([{ userId: 'u-manu', shareCents: 4200 }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
