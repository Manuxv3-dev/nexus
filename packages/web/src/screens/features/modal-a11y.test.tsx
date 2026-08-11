/**
 * Contrat d'accessibilité des 4 modals de détail orga (Event/Expense/Poll/
 * TodoList) — MAN-241, migration vers `useGlassDialogFocusTrap`.
 *
 * Chrome custom (header icône+titre+sous-titre, corps scrollable
 * indépendant, footer épinglé) incompatible avec le rendu de
 * `GlassDialogShell` (cf. sa JSDoc) : ces 4 modaux utilisent la mécanique du
 * hook directement sur leur propre markup, inchangé — d'où un fichier de
 * test séparé de `GlassDialogShell.test.tsx` plutôt qu'une extension de
 * celui-ci.
 *
 * Avant cette migration, le listener Escape de chacun des 4 modaux était un
 * `useEffect` ad hoc qui ignorait `busy` (seul le clic overlay le
 * respectait) : les tests "Escape ferme"/"Escape ne ferme pas pendant une
 * mutation" ci-dessous couvrent explicitement les deux côtés de ce contrat.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as QueriesModule from '@/lib/queries';

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

const cases = [
  {
    name: 'EventModal',
    accessibleName: 'Soirée jeux',
    autoFocusPlaceholder: 'Soirée chez Léa',
    build: (onClose: () => void) => (
      <EventModal mode="view" groupId={GROUP_ID} event={buildEvent()} canEdit onClose={onClose} />
    ),
    buildCreate: (onClose: () => void) => (
      <EventModal mode="create" groupId={GROUP_ID} onClose={onClose} />
    ),
    forceBusy: () =>
      vi.mocked(QueriesModule.useCreateEvent).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof QueriesModule.useCreateEvent>),
    resetBusy: () =>
      vi.mocked(QueriesModule.useCreateEvent).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof QueriesModule.useCreateEvent>),
  },
  {
    name: 'ExpenseModal',
    accessibleName: 'Restaurant',
    autoFocusPlaceholder: 'Restaurant samedi soir',
    build: (onClose: () => void) => (
      <ExpenseModal
        mode="view"
        groupId={GROUP_ID}
        expense={buildExpense()}
        canEdit
        onClose={onClose}
      />
    ),
    buildCreate: (onClose: () => void) => (
      <ExpenseModal mode="create" groupId={GROUP_ID} onClose={onClose} />
    ),
    forceBusy: () =>
      vi.mocked(QueriesModule.useCreateExpense).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof QueriesModule.useCreateExpense>),
    resetBusy: () =>
      vi.mocked(QueriesModule.useCreateExpense).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof QueriesModule.useCreateExpense>),
  },
  {
    name: 'PollModal',
    accessibleName: 'Pizza ou sushi ?',
    autoFocusPlaceholder: 'On mange quoi ce soir ?',
    build: (onClose: () => void) => (
      <PollModal mode="view" groupId={GROUP_ID} poll={buildPoll()} canEdit onClose={onClose} />
    ),
    buildCreate: (onClose: () => void) => (
      <PollModal mode="create" groupId={GROUP_ID} onClose={onClose} />
    ),
    forceBusy: () =>
      vi.mocked(QueriesModule.useCreatePoll).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof QueriesModule.useCreatePoll>),
    resetBusy: () =>
      vi.mocked(QueriesModule.useCreatePoll).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof QueriesModule.useCreatePoll>),
  },
  {
    name: 'TodoListModal',
    accessibleName: 'Courses',
    autoFocusPlaceholder: 'Courses pour la soirée',
    build: (onClose: () => void) => (
      <TodoListModal
        mode="view"
        groupId={GROUP_ID}
        list={buildTodoList()}
        canEdit
        onClose={onClose}
      />
    ),
    buildCreate: (onClose: () => void) => (
      <TodoListModal mode="create" groupId={GROUP_ID} onClose={onClose} />
    ),
    forceBusy: () =>
      vi.mocked(QueriesModule.useCreateTodoList).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof QueriesModule.useCreateTodoList>),
    resetBusy: () =>
      vi.mocked(QueriesModule.useCreateTodoList).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof QueriesModule.useCreateTodoList>),
  },
];

describe('contrat a11y des modals de détail orga (MAN-241)', () => {
  afterEach(() => {
    cases.forEach((c) => c.resetBusy());
  });

  it.each(cases)(
    '$name expose aria-modal="true" et un nom accessible dérivé du titre',
    ({ build, accessibleName }) => {
      render(build(vi.fn()));

      const dialog = screen.getByRole('dialog', { name: accessibleName });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    },
  );

  it.each(cases)(
    '$name : Escape ferme le dialogue quand aucune mutation n’est en cours',
    async ({ build }) => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(build(onClose));

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  // Ancien comportement (avant MAN-241) : le listener Escape ad hoc de ces 4
  // modaux ignorait `busy` — seul le clic overlay le respectait. Sans ce
  // test, retirer `closeDisabled: busy` de l'appel au hook laisserait la
  // suite verte.
  it.each(cases)(
    '$name : Escape NE ferme PAS le dialogue pendant une mutation en cours (`busy`)',
    async ({ build, forceBusy }) => {
      forceBusy();
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(build(onClose));

      await user.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it.each(cases)('$name : le focus initial tombe dans la carte du dialogue', ({ build }) => {
    render(build(vi.fn()));

    const dialog = screen.getByRole('dialog');
    expect(dialog.firstElementChild).toContainElement(document.activeElement as HTMLElement);
  });

  // Revue MAN-241 (C1) : le champ `autoFocus` du mode `create` est appliqué
  // par React pendant la phase de commit, donc AVANT l'effet passif du hook
  // qui pose le focus initial — sans garde-fou, cet effet écrasait
  // systématiquement `autoFocus` par le premier élément focusable de la
  // carte (le bouton ✕ du header, qui précède le corps dans le DOM).
  it.each(cases)(
    '$name (mode create) : ne vole pas le focus au champ `autoFocus`',
    ({ buildCreate, autoFocusPlaceholder }) => {
      render(buildCreate(vi.fn()));

      expect(screen.getByPlaceholderText(autoFocusPlaceholder)).toHaveFocus();
    },
  );
});
