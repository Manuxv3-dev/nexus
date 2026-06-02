/**
 * Repository préférences de notification (cf. ADR-034).
 *
 * Une ligne par user dans `user_notif_prefs`, 1 booléen par `kind`. Lecture
 * paresseuse : `getOrCreatePrefs` crée la ligne all-true au premier accès.
 *
 * `shouldNotify` / `filterRecipientsByPref` sont le point d'enforcement,
 * appelés depuis le choke point d'insertion (repo.ts). Opt-out : tout kind
 * absent de la ligne (ou ligne absente) => autorisé (default true).
 */
import { eq, inArray } from 'drizzle-orm';

import { getDb } from '../../db/client.js';
import { userNotifPrefs, type UserNotifPrefs } from '../../db/schema/index.js';

import type { NotificationKind } from '@nexus/shared';

/** Mappe un `kind` (enum) vers la colonne booléenne correspondante. */
const KIND_TO_COLUMN = {
  event_reminder: 'eventReminder',
  event_rsvp_requested: 'eventRsvpRequested',
  event_rsvp_received: 'eventRsvpReceived',
  expense_added: 'expenseAdded',
  todo_assigned: 'todoAssigned',
  todo_completed: 'todoCompleted',
} as const satisfies Record<NotificationKind, keyof UserNotifPrefs>;

export type PrefColumn = (typeof KIND_TO_COLUMN)[NotificationKind];

export function kindToPrefColumn(kind: NotificationKind): PrefColumn {
  return KIND_TO_COLUMN[kind];
}

/** Toutes les colonnes booléennes (utile pour PATCH partial + DTO). */
export const PREF_COLUMNS: readonly PrefColumn[] = Object.values(KIND_TO_COLUMN);

/**
 * Récupère la ligne de prefs du user, en la créant (all-true) si absente.
 * Idempotent : ON CONFLICT DO NOTHING puis SELECT.
 */
export async function getOrCreatePrefs(userId: string): Promise<UserNotifPrefs> {
  const db = getDb();
  await db.insert(userNotifPrefs).values({ userId }).onConflictDoNothing();
  const [row] = await db.select().from(userNotifPrefs).where(eq(userNotifPrefs.userId, userId));
  if (!row) throw new Error('failed to get-or-create notif prefs');
  return row;
}

/**
 * Applique un patch partiel des booléens. Upsert : crée la ligne (defaults)
 * puis applique. Renvoie la ligne à jour. `updated_at` bumpé.
 */
export async function updatePrefs(
  userId: string,
  patch: Partial<Record<PrefColumn, boolean | undefined>>,
): Promise<UserNotifPrefs> {
  const db = getDb();
  await db.insert(userNotifPrefs).values({ userId }).onConflictDoNothing();
  // Construit un `set` propre : seules les clés réellement fournies (≠ undefined)
  // sont écrites — évite d'envoyer `undefined` à drizzle (exactOptionalPropertyTypes).
  const set: Partial<typeof userNotifPrefs.$inferInsert> = { updatedAt: new Date() };
  for (const col of PREF_COLUMNS) {
    const v = patch[col];
    if (v !== undefined) set[col] = v;
  }
  const [row] = await db
    .update(userNotifPrefs)
    .set(set)
    .where(eq(userNotifPrefs.userId, userId))
    .returning();
  if (!row) throw new Error('failed to update notif prefs');
  return row;
}

/**
 * ENFORCEMENT (single insert) : le user veut-il recevoir ce kind ?
 * Default TRUE (opt-out) y compris si la ligne est absente. Best-effort :
 * une erreur DB renvoie `true` (on n'avale jamais une notif silencieusement).
 */
export async function shouldNotify(userId: string, kind: NotificationKind): Promise<boolean> {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(userNotifPrefs)
      .where(eq(userNotifPrefs.userId, userId));
    if (!row) return true;
    return row[kindToPrefColumn(kind)];
  } catch {
    return true;
  }
}

/**
 * ENFORCEMENT (bulk) : filtre une liste de (userId, kind) en gardant ceux
 * autorisés. 1 seule requête (IN). Default TRUE pour tout user sans ligne.
 * Best-effort : en cas d'erreur, on laisse tout passer.
 */
export async function filterRecipientsByPref<
  T extends { userId: string; kind: NotificationKind },
>(inputs: T[]): Promise<T[]> {
  if (inputs.length === 0) return inputs;
  try {
    const db = getDb();
    const userIds = [...new Set(inputs.map((i) => i.userId))];
    const rows = await db
      .select()
      .from(userNotifPrefs)
      .where(inArray(userNotifPrefs.userId, userIds));
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    return inputs.filter((i) => {
      const row = byUser.get(i.userId);
      if (!row) return true; // pas de ligne => default all-true
      return row[kindToPrefColumn(i.kind)];
    });
  } catch {
    return inputs;
  }
}
