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
  /**
   * Nom d'affichage du porteur de la part (cf. ticket 10af5c92).
   *
   * **Optionnel parce qu'absent des lectures publiques**, délibérément : la
   * page `/d/:slug` est ouverte à quiconque a le lien et n'a jamais montré
   * que des fragments d'identifiant. Servir le même DTO des deux côtés y
   * ferait apparaître de vrais noms.
   *
   * Résolu côté serveur et non plus depuis la liste des membres courants du
   * groupe : une part survit au départ de son porteur (`2f422033` la laisse
   * intacte, c'est de l'argent dû), donc le client ne pouvait plus le nommer
   * et retombait sur `userId.slice(0, 8)` — un fragment d'UUID en face d'un
   * montant en euros.
   */
  userName: z.string().optional(),
});
export type ExpenseShareDto = z.infer<typeof ExpenseShareDtoSchema>;

export const ExpenseDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  tags: z.array(z.string()),
  description: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  paidBy: z.string().uuid(),
  /** Nom d'affichage du payeur. Mêmes règles que `ExpenseShareDto.userName`. */
  paidByName: z.string().optional(),
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
