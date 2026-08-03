/**
 * Profondeur visuelle des 4 modals de détail orga — MAN-112 Task 2.
 *
 * La "carte de détail" d'un item est le panel de la modal (mode `view`) —
 * les anciens stubs `killer-features/*Detail.tsx` @deprecated ont été
 * supprimés (MAN-120). On vérifie ici que les 4 panels partagent le même
 * relief (glass + `NX.shadowMd`, exposé par `screens/features/shared.tsx`)
 * plutôt que de diverger visuellement.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EventModal } from './events/EventModal';
import { ExpenseModal } from './expenses/ExpenseModal';
import { PollModal } from './polls/PollModal';
import { buildEvent, buildExpense, buildPoll, buildTodoList, GROUP_ID } from './testFixtures';
import { TodoListModal } from './todos/TodoListModal';

vi.mock('@/lib/queries', () => ({
  useGroupMembers: vi.fn(() => ({ data: [] })),
  useCreateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useEventRsvp: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreatePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeletePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useVote: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSettleExpenseShare: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useAddTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

describe('profondeur visuelle des panels de détail orga (MAN-112 Task 2)', () => {
  const cases = [
    {
      name: 'EventModal',
      render: () =>
        render(
          <EventModal
            mode="view"
            groupId={GROUP_ID}
            event={buildEvent()}
            canEdit
            onClose={vi.fn()}
          />,
        ),
    },
    {
      name: 'PollModal',
      render: () =>
        render(
          <PollModal mode="view" groupId={GROUP_ID} poll={buildPoll()} canEdit onClose={vi.fn()} />,
        ),
    },
    {
      name: 'ExpenseModal',
      render: () =>
        render(
          <ExpenseModal
            mode="view"
            groupId={GROUP_ID}
            expense={buildExpense()}
            canEdit
            onClose={vi.fn()}
          />,
        ),
    },
    {
      name: 'TodoListModal',
      render: () =>
        render(
          <TodoListModal
            mode="view"
            groupId={GROUP_ID}
            list={buildTodoList()}
            canEdit
            onClose={vi.fn()}
          />,
        ),
    },
  ];

  it.each(cases)(
    '$name applique le token de profondeur nx-shadow-md sur son panel',
    ({ render }) => {
      render();
      const panel = screen.getByRole('dialog').firstElementChild as HTMLElement;
      expect(panel.style.boxShadow).toContain('var(--nx-shadow-md)');
    },
  );

  it('les 4 panels partagent exactement la même valeur de boxShadow (cohérence inter-modules)', () => {
    const shadows = cases.map(({ render }) => {
      const { unmount } = render();
      const panel = screen.getByRole('dialog').firstElementChild as HTMLElement;
      const shadow = panel.style.boxShadow;
      unmount();
      return shadow;
    });

    expect(new Set(shadows).size).toBe(1);
  });
});
