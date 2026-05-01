/**
 * Hooks de fetch pour les pages publiques (`/api/v1/public/...`).
 *
 * Ces endpoints ne demandent pas d'auth (cf. ADR-010 : la page publique est
 * la valeur Nexus partagée hors du compte). Les schémas miroirs des stubs
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
  id: z.string(),
  slug: z.string(),
  groupId: z.string(),
  question: z.string(),
  multi: z.boolean(),
  closesAt: z.string().nullable(),
  options: z.array(z.object({ id: z.string(), label: z.string(), voters: z.array(z.string()) })),
  createdBy: z.string(),
  createdAt: z.string(),
});

const ExpenseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string(),
  description: z.string(),
  amountCents: z.number(),
  currency: z.string(),
  paidBy: z.string(),
  participants: z.array(z.string()),
  createdAt: z.string(),
});

const TodoListSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string(),
  title: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      done: z.boolean(),
      assigneeId: z.string().nullable(),
    }),
  ),
  createdAt: z.string(),
});

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
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/public/polls/${slug}`,
        reply: PollSchema,
        unauthenticated: true,
      }),
  });
}

export function usePublicExpense(slug: string) {
  return useQuery({
    queryKey: ['public-expense', slug],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/public/expenses/${slug}`,
        reply: ExpenseSchema,
        unauthenticated: true,
      }),
  });
}

export function usePublicTodo(slug: string) {
  return useQuery({
    queryKey: ['public-todo', slug],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/public/todos/${slug}`,
        reply: TodoListSchema,
        unauthenticated: true,
      }),
  });
}
