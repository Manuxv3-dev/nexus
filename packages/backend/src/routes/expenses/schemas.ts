/**
 * Schemas Zod Expenses — DTOs renvoyés au client + bodies acceptés.
 *
 * Note sur les montants : on stocke et transporte tout en **cents** (entier)
 * pour éviter les flottants. La conversion en EUR/USD pour l'affichage est
 * faite côté client.
 */
import { z } from 'zod';

// ─────────────────────────── DTOs (replies) ─────────────────────────────

export const ExpenseShareDtoSchema = z.object({
  expenseId: z.string().uuid(),
  userId: z.string().uuid(),
  shareCents: z.number().int().nonnegative(),
  isSettled: z.boolean(),
  settledAt: z.string().nullable(),
});
export type ExpenseShareDto = z.infer<typeof ExpenseShareDtoSchema>;

export const ExpenseDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  description: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  paidBy: z.string().uuid(),
  settledAt: z.string().nullable(),
  shares: z.array(ExpenseShareDtoSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExpenseDto = z.infer<typeof ExpenseDtoSchema>;

export const ExpenseListReplySchema = z.object({ expenses: z.array(ExpenseDtoSchema) });
export const ExpenseReplySchema = z.object({ expense: ExpenseDtoSchema });
export const DeleteExpenseReplySchema = z.object({ ok: z.literal(true) });

// ─────────────────────────── Bodies ─────────────────────────────────────

const ShareInputSchema = z.object({
  userId: z.string().uuid(),
  shareCents: z.number().int().nonnegative(),
});

export const CreateExpenseBodySchema = z.object({
  channelId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  description: z.string().min(1).max(280).trim(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).default('EUR'),
  paidBy: z.string().uuid(),
  shares: z.array(ShareInputSchema).min(1).max(50),
});

export const UpdateExpenseBodySchema = z.object({
  channelId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  description: z.string().min(1).max(280).trim().optional(),
  amountCents: z.number().int().positive().optional(),
  currency: z.string().length(3).optional(),
  paidBy: z.string().uuid().optional(),
  shares: z.array(ShareInputSchema).min(1).max(50).optional(),
});

export const SettleShareBodySchema = z.object({
  /** true = je marque ma part comme réglée ; false = je remets ouvert. */
  settled: z.boolean(),
});

// ─────────────────────────── Params / Query ─────────────────────────────

export const GroupIdParamsSchema = z.object({ groupId: z.string().uuid() });
export const ExpenseIdParamsSchema = z.object({ expenseId: z.string().uuid() });
export const SlugParamsSchema = z.object({ slug: z.string().min(4).max(64) });

export const ListExpensesQuerySchema = z.object({
  state: z.enum(['open', 'settled', 'all']).optional(),
  channelId: z.string().uuid().optional(),
});
