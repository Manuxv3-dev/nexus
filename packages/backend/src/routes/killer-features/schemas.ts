import { z } from 'zod';

/**
 * Schémas Zod pour les killer features (events / polls / expenses / todos).
 *
 * STUB J4b — Ces schémas resteront stables côté front même quand les vraies
 * implémentations J5 arriveront. Les seuls champs ajoutés en J5 seront
 * possiblement `permissions`, `version` (pour optimistic concurrency), etc.
 */

const RsvpValueSchema = z.enum(['yes', 'maybe', 'no']);

export const EventSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string().datetime(),
  location: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  rsvps: z.record(RsvpValueSchema.nullable()),
});

export const ListEventsReplySchema = z.object({
  events: z.array(EventSchema),
});

export const PollOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  voters: z.array(z.string()),
});

export const PollSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string().uuid(),
  question: z.string(),
  multi: z.boolean(),
  closesAt: z.string().datetime().nullable(),
  options: z.array(PollOptionSchema),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
});

export const ListPollsReplySchema = z.object({
  polls: z.array(PollSchema),
});

export const ExpenseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int(),
  currency: z.string().min(3).max(3),
  paidBy: z.string(),
  participants: z.array(z.string()),
  createdAt: z.string().datetime(),
});

export const BalanceSchema = z.object({
  from: z.string(),
  to: z.string(),
  amountCents: z.number().int().positive(),
});

export const ListExpensesReplySchema = z.object({
  expenses: z.array(ExpenseSchema),
  balances: z.array(BalanceSchema),
});

export const TodoItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
  assigneeId: z.string().nullable(),
});

export const TodoListSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string().uuid(),
  title: z.string(),
  items: z.array(TodoItemSchema),
  createdAt: z.string().datetime(),
});

export const ListTodosReplySchema = z.object({
  lists: z.array(TodoListSchema),
});

export const GroupIdParamsSchema = z.object({
  groupId: z.string().uuid(),
});
export const SlugParamsSchema = z.object({
  slug: z.string().min(4).max(64),
});
