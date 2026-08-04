/**
 * Repository Notifications — accès Drizzle à la table `notifications`
 * (cf. ADR-023, J5b V1.2).
 *
 * Garde les routes Fastify minces (validation + auth + appel repo + WS).
 *
 * Exposé pour les producteurs : worker `event-reminders` (cf. ADR-020 enrichi
 * en C2), routes mutations (POST events / POST expenses / PATCH todo-items)
 * qui appellent `insertNotification` après commit DB.
 *
 * `insertNotification`/`insertNotificationsBulk` sont AUSSI le choke point
 * d'envoi push (cf. MAN-142, phase 1 de MAN-24) : un seul endroit à modifier
 * pour brancher `sendPushToUser`, pas chaque site d'appel producteur.
 */
import type { NotificationKind } from '@nexus/shared';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';

import { logger } from '../../core/logger.js';
import { getDb } from '../../db/client.js';
import { notifications, type Notification, type NewNotification } from '../../db/schema/index.js';
import { sendPushToUser } from '../push/repo.js';

import { filterRecipientsByPref, shouldNotify } from './prefs-repo.js';

/**
 * Déclenche l'envoi push best-effort pour une notif déjà insérée. Ne relance
 * jamais — un échec est logué et n'affecte jamais le caller (choke point
 * d'insertion, cf. `insertNotification`/`insertNotificationsBulk`).
 */
async function pushBestEffort(row: Notification): Promise<void> {
  try {
    await sendPushToUser(row.userId, {
      kind: row.kind,
      payload: row.payload as Record<string, unknown>,
    });
  } catch (err) {
    logger.warn({ err, userId: row.userId, kind: row.kind }, 'push send failed after notif insert');
  }
}

export interface InsertNotificationInput {
  userId: string;
  kind: NotificationKind;
  /** Payload JSONB libre, shape par kind documentée dans schemas.ts. */
  payload: Record<string, unknown>;
  /** Group concerné (pour deep-linking). NULL pour notifs cross-group V2. */
  groupId?: string | null;
  /** ID de la ressource source (event, expense, todo_item). */
  sourceId?: string | null;
}

/**
 * Insert une notification — SAUF si le user a désactivé ce `kind` (ADR-034),
 * auquel cas on renvoie `null` (ni insert DB, ni WS push côté caller). Le
 * caller garde donc son publish WS derrière le `null`.
 *
 * Best-effort côté caller : un échec ne devrait pas faire échouer la mutation
 * métier qui l'a déclenchée. Le caller gère le try/catch + log.
 */
export async function insertNotification(
  input: InsertNotificationInput,
): Promise<Notification | null> {
  if (!(await shouldNotify(input.userId, input.kind))) return null;
  const db = getDb();
  const insert: NewNotification = {
    userId: input.userId,
    kind: input.kind,
    payload: input.payload,
    groupId: input.groupId ?? null,
    sourceId: input.sourceId ?? null,
  };
  const [row] = await db.insert(notifications).values(insert).returning();
  if (!row) throw new Error('insert notification failed');
  await pushBestEffort(row);
  return row;
}

/**
 * Insert N notifs en une seule requête. Utilisé par le worker
 * `event-reminders` quand on fan-out à tous les members d'un group.
 *
 * Enforcement ADR-034 : on filtre d'abord les (userId, kind) désactivés
 * avant l'insert. Les callers itèrent sur les lignes RENVOYÉES pour publier
 * le WS, donc les recipients filtrés sont automatiquement skippés.
 */
export async function insertNotificationsBulk(
  inputs: InsertNotificationInput[],
): Promise<Notification[]> {
  if (inputs.length === 0) return [];
  const allowed = await filterRecipientsByPref(inputs);
  if (allowed.length === 0) return [];
  const db = getDb();
  const values: NewNotification[] = allowed.map((i) => ({
    userId: i.userId,
    kind: i.kind,
    payload: i.payload,
    groupId: i.groupId ?? null,
    sourceId: i.sourceId ?? null,
  }));
  const rows = await db.insert(notifications).values(values).returning();
  await Promise.all(rows.map((row) => pushBestEffort(row)));
  return rows;
}

export interface ListNotificationsFilter {
  /** Filtre unread uniquement. Undefined ou false = unread + read mélangés. */
  unread?: boolean;
  /** Cursor par created_at ISO. Renvoie les notifs strictement plus anciennes. */
  cursor?: string;
  /** Limite d'items renvoyés. */
  limit?: number;
}

export interface ListNotificationsResult {
  notifications: Notification[];
  /** Cursor à passer pour la page suivante. NULL = dernière page. */
  nextCursor: string | null;
}

/**
 * Liste paginée des notifs d'un user (created_at desc).
 *
 * Cursor pagination : le `cursor` est l'ISO string du `created_at` du
 * dernier item de la page précédente. La requête renvoie les notifs
 * strictement plus anciennes (`created_at < cursor`).
 */
export async function listNotificationsForUser(
  userId: string,
  filter: ListNotificationsFilter = {},
): Promise<ListNotificationsResult> {
  const db = getDb();
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);

  const conditions = [eq(notifications.userId, userId)];
  if (filter.unread === true) conditions.push(isNull(notifications.readAt));
  if (filter.cursor) {
    conditions.push(lt(notifications.createdAt, new Date(filter.cursor)));
  }

  // +1 pour savoir s'il y a une page suivante
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? lastItem.createdAt.toISOString() : null;

  return { notifications: items, nextCursor };
}

/**
 * Compte les notifs unread du user. Utilisé par le badge cloche.
 * O(1) via l'index user_unread.
 */
export async function countUnreadForUser(userId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/**
 * Marque une notif comme lue. Idempotent : une notif déjà lue retourne
 * silencieusement (pas d'erreur).
 *
 * Renvoie true si une notif a été modifiée, false si non trouvée ou
 * appartenant à un autre user (ne pas leak).
 */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return result.length > 0;
}

/**
 * Marque toutes les notifs unread du user comme lues. Renvoie le nombre
 * de notifs modifiées (utile pour debug/UI feedback).
 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return result.length;
}

/**
 * Supprime TOUTES les notifications du user (read + unread). Action
 * déclenchée par le bouton "Vider" du panel — l'user veut nettoyer son
 * historique. Les events/expenses/todos sous-jacents ne sont pas touchés ;
 * seules les notifications agrégées disparaissent.
 *
 * Renvoie le nombre de lignes supprimées (utile pour le debug et
 * l'invalidation côté front).
 */
export async function deleteAllNotificationsForUser(userId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(notifications)
    .where(eq(notifications.userId, userId))
    .returning({ id: notifications.id });
  return result.length;
}

/**
 * Purge les notifs de plus de N jours. Utilisé par le worker BullMQ
 * nocturne (cf. ADR-023 lot C4).
 */
export async function purgeOldNotifications(olderThanDays: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoff))
    .returning({ id: notifications.id });
  return result.length;
}
