/**
 * Schemas Zod Expenses — DTOs renvoyés au client + bodies acceptés.
 *
 * Note sur les montants : on stocke et transporte tout en **cents** (entier)
 * pour éviter les flottants. La conversion en EUR/USD pour l'affichage est
 * faite côté client.
 *
 * Les DTO de réponse (`ExpenseShareDtoSchema`, `ExpenseDtoSchema`) vivent
 * dans `@nexus/shared` (cf. ticket 0e8b5905) et sont ré-exportés ici pour ne
 * pas casser les imports internes du package `routes/expenses/`. Le web les
 * importe directement depuis `@nexus/shared`.
 */
import { ExpenseDtoSchema, ExpenseShareDtoSchema } from '@nexus/shared';
import { z } from 'zod';

export { ExpenseShareDtoSchema, ExpenseDtoSchema };
export type { ExpenseShareDto, ExpenseDto } from '@nexus/shared';

// ─────────────────────────── DTOs (replies) ─────────────────────────────

export const ExpenseListReplySchema = z.object({ expenses: z.array(ExpenseDtoSchema) });
export const ExpenseReplySchema = z.object({ expense: ExpenseDtoSchema });
export const DeleteExpenseReplySchema = z.object({ ok: z.literal(true) });

// ─────────────────────────── Bodies ─────────────────────────────────────

const ShareInputSchema = z.object({
  userId: z.string().uuid(),
  shareCents: z.number().int().nonnegative(),
});

export const CreateExpenseBodySchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  description: z.string().min(1).max(280).trim(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).default('EUR'),
  paidBy: z.string().uuid(),
  shares: z.array(ShareInputSchema).min(1).max(50),
});

export const UpdateExpenseBodySchema = z.object({
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
});
