/**
 * Hooks de fetch pour les pages publiques (`/api/v1/public/...`).
 *
 * Ces endpoints ne demandent pas d'auth (cf. ADR-010 : la page publique est
 * la valeur nexus partagée hors du compte). Les schémas miroirs des stubs
 * J4b vivent ici en miniature pour ne pas dépendre du backend.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api';

const RsvpValueSchema = z.enum(['yes', 'maybe', 'no']);

const EventSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  location: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rsvps: z.array(
    z.object({ userId: z.string().uuid(), value: RsvpValueSchema }),
  ),
});

const EventReply = z.object({ event: EventSchema });

const PollSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  question: z.string(),
  multi: z.boolean(),
  closesAt: z.string().nullable(),
  options: z.array(
    z.object({
      id: z.string().uuid(),
      pollId: z.string().uuid(),
      label: z.string(),
      position: z.number().int(),
      voters: z.array(z.string().uuid()),
    }),
  ),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const PollReply = z.object({ poll: PollSchema });

// Aligné sur `packages/backend/src/routes/expenses/schemas.ts → ExpenseDtoSchema`.
const ExpenseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  description: z.string(),
  amountCents: z.number().int(),
  currency: z.string().length(3),
  paidBy: z.string().uuid(),
  settledAt: z.string().nullable(),
  shares: z.array(
    z.object({
      expenseId: z.string().uuid(),
      userId: z.string().uuid(),
      shareCents: z.number().int(),
      isSettled: z.boolean(),
      settledAt: z.string().nullable(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ExpenseReply = z.object({ expense: ExpenseSchema });

// Aligné sur `packages/backend/src/routes/todos/schemas.ts → TodoListDtoSchema`.
const TodoListSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  title: z.string(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      listId: z.string().uuid(),
      text: z.string(),
      done: z.boolean(),
      assigneeId: z.string().uuid().nullable(),
      position: z.number().int(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const TodoListReply = z.object({ todoList: TodoListSchema });

export function usePublicEvent(slug: string) {
  return useQuery({
    queryKey: ['public-event', slug],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/public/events/${slug}`,
        reply: EventReply,
        unauthenticated: true,
      }).then((r) => r.event),
  });
}

export function usePublicPoll(slug: string) {
  return useQuery({
    queryKey: ['public-poll', slug],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/public/polls/${slug}`,
        reply: PollReply,
        unauthenticated: true,
      }).then((r) => r.poll),
  });
}

export function usePublicExpense(slug: string) {
  return useQuery({
    queryKey: ['public-expense', slug],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/public/expenses/${slug}`,
        reply: ExpenseReply,
        unauthenticated: true,
      }).then((r) => r.expense),
  });
}

export function usePublicTodo(slug: string) {
  return useQuery({
    queryKey: ['public-todo', slug],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/public/todos/${slug}`,
        reply: TodoListReply,
        unauthenticated: true,
      }).then((r) => r.todoList),
  });
}
