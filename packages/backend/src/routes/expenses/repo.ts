/**
 * Repository Expenses — accès Drizzle aux tables `expenses` et
 * `expense_shares`.
 *
 * Conventions :
 *  - Montants en cents (entier) pour éviter les flottants.
 *  - `paid_by` peut figurer dans les shares (Splitwise/Tricount style :
 *    le payeur a sa propre part).
 *  - Somme des `share_cents` doit == `amount_cents`. Vérifié côté service.
 *  - `expense.settled_at` est calculé à partir des shares :
 *      → null tant qu'une share au moins n'est pas settled
 *      → max(shares.settledAt) quand toutes settled.
 *  - Touch `updated_at` à chaque mutation pour invalider le cache OG image.
 */
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { AppError } from '../../core/errors.js';
import { generateSlug } from '../../core/slug-generator.js';
import { getDb } from '../../db/client.js';
import {
  expenseShares,
  expenses,
  type Expense,
  type ExpenseShare,
  type NewExpense,
  type NewExpenseShare,
} from '../../db/schema/index.js';

// ─────────────────────────── Types ──────────────────────────────────────

export interface ExpenseWithShares extends Expense {
  shares: ExpenseShare[];
}

export interface CreateExpenseInput {
  groupId: string;
  tags?: string[];
  description: string;
  amountCents: number;
  currency: string;
  paidBy: string;
  shares: { userId: string; shareCents: number }[];
}

export interface UpdateExpenseInput {
  tags?: string[];
  description?: string;
  amountCents?: number;
  currency?: string;
  paidBy?: string;
  /**
   * Si fourni, remplace intégralement la liste des shares (pattern POST/PATCH
   * style "set" — pas de patch granulaire share-par-share).
   */
  shares?: { userId: string; shareCents: number }[];
}

// ─────────────────────────── Helpers ─────────────────────────────────────

function assertSharesSum(
  amountCents: number,
  shares: { userId: string; shareCents: number }[],
): void {
  if (shares.length === 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'no_shares' });
  }
  const sum = shares.reduce((a, s) => a + s.shareCents, 0);
  if (sum !== amountCents) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'shares_sum_mismatch',
      sum,
      expected: amountCents,
    });
  }
  // Pas de share négative ni de doublons d'user.
  const seen = new Set<string>();
  for (const s of shares) {
    if (s.shareCents < 0)
      throw new AppError('VALIDATION_ERROR', { reason: 'negative_share' });
    if (seen.has(s.userId))
      throw new AppError('VALIDATION_ERROR', { reason: 'duplicate_user_share' });
    seen.add(s.userId);
  }
}

/**
 * Recalcule `expenses.settled_at` à partir des shares actuelles.
 * Touch `updated_at` au passage. Appelle directement le client DB global
 * — les chemins appelants doivent garantir que les writes précédents sont
 * commités (ou être eux-mêmes encapsulés dans une transaction qui inclut
 * cet appel).
 */
async function recomputeSettledAt(expenseId: string): Promise<void> {
  const db = getDb();
  const shares = await db
    .select()
    .from(expenseShares)
    .where(eq(expenseShares.expenseId, expenseId));
  const allSettled = shares.length > 0 && shares.every((s) => s.isSettled);
  const maxSettledAt = allSettled
    ? shares.reduce<Date | null>((max, s) => {
        if (!s.settledAt) return max;
        if (!max || s.settledAt.getTime() > max.getTime()) return s.settledAt;
        return max;
      }, null)
    : null;
  await db
    .update(expenses)
    .set({ settledAt: maxSettledAt, updatedAt: new Date() })
    .where(eq(expenses.id, expenseId));
}

// ─────────────────────────── Mutations ───────────────────────────────────

export async function createExpense(input: CreateExpenseInput): Promise<ExpenseWithShares> {
  assertSharesSum(input.amountCents, input.shares);
  const db = getDb();
  const slug = generateSlug();
  const insert: NewExpense = {
    slug,
    groupId: input.groupId,
    tags: input.tags ?? [],
    description: input.description,
    amountCents: input.amountCents,
    currency: input.currency,
    paidBy: input.paidBy,
    settledAt: null,
  };
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.insert(expenses).values(insert).returning();
    if (!row) throw new Error('insert expense failed');
    const sharesInsert: NewExpenseShare[] = input.shares.map((s) => ({
      expenseId: row.id,
      userId: s.userId,
      shareCents: s.shareCents,
      isSettled: false,
      settledAt: null,
    }));
    await tx.insert(expenseShares).values(sharesInsert);
    return row;
  });
  const full = await getExpenseById(result.id);
  if (!full) throw new Error('expense vanished after insert');
  return full;
}

export async function updateExpense(
  id: string,
  patch: UpdateExpenseInput,
): Promise<ExpenseWithShares | null> {
  const db = getDb();
  // Si on remplace les shares, on revalide la somme contre le nouveau total
  // (qui peut lui-même bouger via patch.amountCents).
  const existing = await getExpenseById(id);
  if (!existing) return null;
  const newAmount = patch.amountCents ?? existing.amountCents;
  if (patch.shares) {
    assertSharesSum(newAmount, patch.shares);
  }

  await db.transaction(async (tx) => {
    const set: Partial<NewExpense> & { updatedAt: Date } = { updatedAt: new Date() };
    if (patch.tags !== undefined) set.tags = patch.tags;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.amountCents !== undefined) set.amountCents = patch.amountCents;
    if (patch.currency !== undefined) set.currency = patch.currency;
    if (patch.paidBy !== undefined) set.paidBy = patch.paidBy;
    await tx.update(expenses).set(set).where(eq(expenses.id, id));

    if (patch.shares) {
      // Replace strategy : delete + insert. Plus simple que diff fin et
      // suffisant pour le MVP (volume de shares < 50 par expense).
      await tx.delete(expenseShares).where(eq(expenseShares.expenseId, id));
      const sharesInsert: NewExpenseShare[] = patch.shares.map((s) => ({
        expenseId: id,
        userId: s.userId,
        shareCents: s.shareCents,
        isSettled: false,
        settledAt: null,
      }));
      await tx.insert(expenseShares).values(sharesInsert);
    }
  });

  // Si on a touché aux shares, recompute settledAt (toutes les shares ont
  // été reset à isSettled=false → expense passe de settled à non-settled).
  if (patch.shares) {
    await recomputeSettledAt(id);
  }

  return getExpenseById(id);
}

export async function deleteExpense(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(expenses)
    .where(eq(expenses.id, id))
    .returning({ id: expenses.id });
  return result.length > 0;
}

/**
 * Marque la share `(expenseId, userId)` comme settled / unsettled.
 * Recalcule `expense.settled_at` au passage.
 */
export async function setShareSettled(
  expenseId: string,
  userId: string,
  settled: boolean,
): Promise<void> {
  const db = getDb();
  const [share] = await db
    .select()
    .from(expenseShares)
    .where(and(eq(expenseShares.expenseId, expenseId), eq(expenseShares.userId, userId)))
    .limit(1);
  if (!share) {
    throw new AppError('RESOURCE_NOT_FOUND', { reason: 'share_not_found' });
  }
  await db
    .update(expenseShares)
    .set({
      isSettled: settled,
      settledAt: settled ? new Date() : null,
    })
    .where(
      and(eq(expenseShares.expenseId, expenseId), eq(expenseShares.userId, userId)),
    );
  await recomputeSettledAt(expenseId);
}

// ─────────────────────────── Lectures ────────────────────────────────────

export async function getExpenseById(id: string): Promise<ExpenseWithShares | null> {
  const db = getDb();
  const [row] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!row) return null;
  return hydrate(row);
}

export async function getExpenseBySlug(slug: string): Promise<ExpenseWithShares | null> {
  const db = getDb();
  const [row] = await db.select().from(expenses).where(eq(expenses.slug, slug)).limit(1);
  if (!row) return null;
  return hydrate(row);
}

async function hydrate(row: Expense): Promise<ExpenseWithShares> {
  const db = getDb();
  const shares = await db
    .select()
    .from(expenseShares)
    .where(eq(expenseShares.expenseId, row.id));
  return { ...row, shares };
}

export interface ListExpensesFilter {
  /** 'open' = settled_at IS NULL ; 'settled' = settled_at NOT NULL ; 'all' (défaut) */
  state?: 'open' | 'settled' | 'all';
}

export async function listExpensesByGroup(
  groupId: string,
  filter: ListExpensesFilter = {},
): Promise<ExpenseWithShares[]> {
  const db = getDb();
  const state = filter.state ?? 'all';
  const conditions = [eq(expenses.groupId, groupId)];
  if (state === 'open') {
    conditions.push(isNull(expenses.settledAt));
  } else if (state === 'settled') {
    conditions.push(isNotNull(expenses.settledAt));
  }
  const rows = await db
    .select()
    .from(expenses)
    .where(and(...conditions))
    .orderBy(asc(expenses.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const allShares = await db
    .select()
    .from(expenseShares)
    .where(inArray(expenseShares.expenseId, ids));
  const sharesByExpense = new Map<string, ExpenseShare[]>();
  for (const s of allShares) {
    const list = sharesByExpense.get(s.expenseId) ?? [];
    list.push(s);
    sharesByExpense.set(s.expenseId, list);
  }
  return rows.map((r) => ({ ...r, shares: sharesByExpense.get(r.id) ?? [] }));
}
