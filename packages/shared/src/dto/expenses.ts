import { z } from 'zod';

/**
 * DTO Expenses partagé backend/web (cf. ticket 0e8b5905).
 *
 * Source de vérité unique pour la forme renvoyée par
 * `packages/backend/src/routes/expenses/schemas.ts` (`ExpenseDtoSchema`) et
 * consommée par `@nexus/web` (`packages/web/src/lib/queries.ts`).
 *
 * Montants transportés en **cents** (entier), conversion EUR/USD faite côté
 * client. Les schémas de **body** (create/update/settle) et de
 * **query/params** restent dans `packages/backend/src/routes/expenses/schemas.ts`.
 */

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
