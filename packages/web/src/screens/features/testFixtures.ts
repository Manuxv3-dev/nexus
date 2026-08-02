/**
 * Fixtures partagées pour les tests des 4 modals orga (Event/Poll/Expense/
 * TodoList) — MAN-112 Phase 3. Pas un fichier de test (pas de suffixe
 * `.test`/`.spec`) : vitest ne le collecte pas comme suite.
 *
 * `EventDetail.tsx`/`PollDetail.tsx`/`ExpenseDetail.tsx`/`TodoDetail.tsx`
 * (cf. `screens/app/killer-features/`) sont des stubs `@deprecated` vides :
 * la vue "détail" d'un item vit désormais dans le mode `view` de ces 4
 * modals (`screens/features/{events,expenses,polls,todos}/*Modal.tsx`).
 */
import type { EventDto, ExpenseDto, PollDto, TodoListDto } from '@/lib/queries';

export const GROUP_ID = 'group-1';
export const USER_ID = 'user-1';
export const OTHER_USER_ID = 'user-2';

export function buildEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'event-1',
    slug: 'event-1-slug',
    groupId: GROUP_ID,
    tags: [],
    title: 'Soirée jeux',
    description: null,
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    location: null,
    createdBy: OTHER_USER_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rsvps: [],
    ...overrides,
  };
}

export function buildPoll(overrides: Partial<PollDto> = {}): PollDto {
  return {
    id: 'poll-1',
    slug: 'poll-1-slug',
    groupId: GROUP_ID,
    tags: [],
    question: 'Pizza ou sushi ?',
    multi: false,
    closesAt: null,
    options: [
      { id: 'opt-1', pollId: 'poll-1', label: 'Pizza', position: 0, voters: [] },
      { id: 'opt-2', pollId: 'poll-1', label: 'Sushi', position: 1, voters: [] },
    ],
    createdBy: OTHER_USER_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function buildExpense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'expense-1',
    slug: 'expense-1-slug',
    groupId: GROUP_ID,
    tags: [],
    description: 'Restaurant',
    amountCents: 4000,
    currency: 'EUR',
    paidBy: OTHER_USER_ID,
    settledAt: null,
    shares: [
      {
        expenseId: 'expense-1',
        userId: USER_ID,
        shareCents: 2000,
        isSettled: false,
        settledAt: null,
      },
      {
        expenseId: 'expense-1',
        userId: OTHER_USER_ID,
        shareCents: 2000,
        isSettled: true,
        settledAt: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function buildTodoList(overrides: Partial<TodoListDto> = {}): TodoListDto {
  return {
    id: 'list-1',
    slug: 'list-1-slug',
    groupId: GROUP_ID,
    tags: [],
    title: 'Courses',
    items: [
      {
        id: 'item-1',
        listId: 'list-1',
        text: 'Pain',
        done: false,
        assigneeId: null,
        position: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'item-2',
        listId: 'list-1',
        text: 'Lait (déjà cochée)',
        done: true,
        assigneeId: null,
        position: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    createdBy: OTHER_USER_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
