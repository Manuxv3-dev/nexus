/**
 * MAN-246 point 6, côté web — les actions destructives sont grisées, jamais
 * masquées, et un owner/admin les retrouve sur le contenu des autres.
 *
 * Les 4 dashboards calculaient `canEdit={createdBy === user.id}`, strictement
 * plus restrictif que le serveur : un owner de groupe ne voyait pas des actions
 * qu'il avait pourtant le droit de faire. Ils passent désormais tous par
 * `canManageGroupItem` (règle testée à part dans `lib/permissions.test.ts`) ;
 * ce fichier verrouille le **câblage** de chacun — c'est là qu'un mauvais champ
 * d'auteur (`createdBy` au lieu de `paidBy`) passerait le typecheck sans
 * broncher.
 *
 * Le rendu suit la règle « griser plutôt que masquer » posée par
 * `GroupMembersPanel` : une action interdite reste visible et décrite, pour que
 * l'utilisateur comprenne qu'elle existe et à qui elle appartient, plutôt que
 * de croire qu'elle n'existe pas.
 *
 * Tous les fixtures sont créés par `OTHER_USER_ID` — le viewer par défaut
 * (`USER_ID`) n'en est donc jamais l'auteur, et seul son rôle décide.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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

const eventFixture = buildEvent();
const pollFixture = buildPoll();
const expenseFixture = buildExpense({ paidBy: OTHER_USER_ID });
const todoListFixture = buildTodoList();

const { useGroupsMock } = vi.hoisted(() => ({ useGroupsMock: vi.fn() }));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: useGroupsMock,
    useGroupMembers: () => ({ data: [] }),
    useEvents: (_g: string | undefined, filter: { when?: string }) => ({
      data: filter.when === 'past' ? [] : [eventFixture],
      isLoading: false,
      isPending: false,
      isError: false,
    }),
    useEvent: () => ({ data: undefined }),
    usePolls: () => ({ data: [pollFixture], isLoading: false, isPending: false, isError: false }),
    useExpenses: () => ({
      data: [expenseFixture],
      isLoading: false,
      isPending: false,
      isError: false,
    }),
    useTodoLists: () => ({
      data: [todoListFixture],
      isLoading: false,
      isPending: false,
      isError: false,
    }),
  };
});

type Role = 'owner' | 'admin' | 'member';

function setViewer(userId: string, role: Role) {
  useAuth.setState({ user: { id: userId } as ReturnType<typeof useAuth.getState>['user'] });
  useGroupsMock.mockReturnValue({
    data: [
      {
        id: GROUP_ID,
        name: 'La Bande',
        createdBy: OTHER_USER_ID,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        role,
      },
    ],
    isLoading: false,
    isPending: false,
    isError: false,
  });
}

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Chaque dashboard s'ouvre par un clic sur la carte de son item. */
const DASHBOARDS = [
  {
    name: 'EventsDashboard',
    element: <EventsDashboard groupId={GROUP_ID} />,
    openName: /Voir l'événement/,
  },
  {
    name: 'PollsDashboard',
    element: <PollsDashboard groupId={GROUP_ID} />,
    openName: /Pizza ou sushi/,
  },
  {
    name: 'ExpensesDashboard',
    element: <ExpensesDashboard groupId={GROUP_ID} />,
    openName: new RegExp(expenseFixture.description),
  },
  {
    name: 'TodosDashboard',
    element: <TodosDashboard groupId={GROUP_ID} />,
    openName: new RegExp(todoListFixture.title),
  },
] as const;

async function openItemModal(element: React.ReactElement, openName: RegExp): Promise<HTMLElement> {
  const user = userEvent.setup();
  withClient(element);
  await user.click(screen.getByRole('button', { name: openName }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  setViewer(USER_ID, 'member');
});

describe('Actions destructives — grisées, jamais masquées (MAN-246)', () => {
  for (const { name, element, openName } of DASHBOARDS) {
    describe(name, () => {
      it("laisse « Supprimer » visible et inerte pour un membre simple qui n'est pas l'auteur", async () => {
        const dialog = await openItemModal(element, openName);

        const del = within(dialog).getByRole('button', { name: 'Supprimer' });
        // Visible : masquer ferait croire que l'action n'existe pas.
        expect(del).toBeInTheDocument();
        expect(del).toHaveAttribute('aria-disabled', 'true');
        // Et décrite : sinon un lecteur d'écran annonce un bouton inerte sans
        // dire pourquoi.
        expect(del).toHaveAccessibleDescription(/auteur ou un administrateur/);
      });

      it("rend « Supprimer » actionnable pour l'owner du groupe", async () => {
        setViewer(USER_ID, 'owner');
        const dialog = await openItemModal(element, openName);

        const del = within(dialog).getByRole('button', { name: 'Supprimer' });
        expect(del).not.toHaveAttribute('aria-disabled', 'true');
        expect(del).not.toHaveAccessibleDescription(/auteur ou un administrateur/);
      });

      it('rend « Supprimer » actionnable pour un admin du groupe', async () => {
        setViewer(USER_ID, 'admin');
        const dialog = await openItemModal(element, openName);

        expect(within(dialog).getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute(
          'aria-disabled',
          'true',
        );
      });

      it("rend « Supprimer » actionnable pour l'auteur, même simple membre", async () => {
        setViewer(OTHER_USER_ID, 'member');
        const dialog = await openItemModal(element, openName);

        expect(within(dialog).getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute(
          'aria-disabled',
          'true',
        );
      });
    });
  }

  // `EventModal` est le seul à porter aussi un bouton « Modifier ».
  describe('EventsDashboard — bouton « Modifier »', () => {
    it('reste visible et inerte pour un membre simple', async () => {
      const dialog = await openItemModal(DASHBOARDS[0].element, DASHBOARDS[0].openName);

      const edit = within(dialog).getByRole('button', { name: 'Modifier' });
      expect(edit).toBeInTheDocument();
      expect(edit).toHaveAttribute('aria-disabled', 'true');
    });

    it("redevient actionnable pour l'owner", async () => {
      setViewer(USER_ID, 'owner');
      const dialog = await openItemModal(DASHBOARDS[0].element, DASHBOARDS[0].openName);

      expect(within(dialog).getByRole('button', { name: 'Modifier' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });
  });

  it("l'autorisation d'une dépense suit le payeur, pas un createdBy", async () => {
    // `ExpenseDto` porte les deux notions ; côté serveur c'est `paidBy` qui
    // fait autorité. Passer `createdBy` par distraction aurait passé le
    // typecheck sans broncher — deux `string`.
    setViewer(expenseFixture.paidBy, 'member');
    const dialog = await openItemModal(DASHBOARDS[2].element, DASHBOARDS[2].openName);

    expect(within(dialog).getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
