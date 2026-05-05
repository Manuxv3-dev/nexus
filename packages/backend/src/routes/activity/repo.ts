/**
 * Repository Activity Log (cf. ADR-029).
 *
 * Deux fonctions principales :
 *
 *   - `recordActivity(...)` : insert append-only depuis les routes mutation
 *     (events / polls / expenses / todos / groups). Best-effort côté caller :
 *     un échec ne casse pas la mutation principale (cf. helper centralisé
 *     plus bas qui catch + log).
 *
 *   - `listActivity(...)` : lecture paginée cursor-based (timestamp ISO),
 *     filtrée par membership côté SQL. Filtre optionnel par groupId.
 */
import { and, desc, eq, lt } from 'drizzle-orm';

import { getDb } from '../../db/client.js';
import {
  activityLog,
  groupMembers,
  groups,
  users,
  type ActivityLog,
  type NewActivityLog,
} from '../../db/schema/index.js';

import {
  ACTIVITY_DEFAULT_LIMIT,
  type ActivityKind,
  type ActivityPayload,
  type ActivityTargetType,
} from './schemas.js';

export interface RecordActivityInput {
  groupId: string;
  /** NULL si l'actor n'est pas connu (ex : action système). */
  actorId: string | null;
  kind: ActivityKind;
  /** ID de la cible (event, poll, expense, etc.). NULL pour member:joined/left. */
  targetId: string | null;
  targetType: ActivityTargetType;
  /** Snapshot dénormalisé. Voir ActivityPayloadSchema pour les champs attendus. */
  payload: ActivityPayload;
}

/**
 * Insert une entrée d'activité. Lance une exception en cas d'échec — le
 * caller doit wrapper dans un try/catch pour ne pas casser sa mutation.
 *
 * Le helper `recordActivitySafely` ci-dessous s'occupe du try/catch.
 */
export async function recordActivity(input: RecordActivityInput): Promise<ActivityLog> {
  const db = getDb();
  const insert: NewActivityLog = {
    groupId: input.groupId,
    actorId: input.actorId,
    kind: input.kind,
    targetId: input.targetId,
    targetType: input.targetType,
    payload: input.payload,
  };
  const [row] = await db.insert(activityLog).values(insert).returning();
  if (!row) throw new Error('insert activity_log failed');
  return row;
}

/**
 * Wrapper "best-effort" : un échec d'écriture activity_log NE DOIT PAS
 * faire échouer la mutation métier qui l'a déclenché (l'event a été créé,
 * le poll voté, etc.). On log un warn et on continue silencieusement.
 *
 * À utiliser systématiquement depuis les routes plutôt que `recordActivity`
 * directement, sauf si tu veux explicitement propager l'erreur.
 */
export async function recordActivitySafely(
  input: RecordActivityInput,
  logger?: { warn: (msg: string, err?: unknown) => void },
): Promise<void> {
  try {
    await recordActivity(input);
  } catch (err) {
    if (logger) {
      logger.warn(`[activity] record failed (kind=${input.kind})`, err);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[activity] record failed (kind=${input.kind})`, err);
    }
  }
}

/**
 * Variante qui résout automatiquement `groupName` et `actorName` via une
 * single SELECT JOIN, puis insert l'entrée. Utile pour les call sites qui
 * n'ont pas déjà résolu ces deux infos (la majorité des routes).
 *
 * Usage typique :
 *
 * ```ts
 * await recordActivityWithLookup({
 *   groupId: ctx.groupId,
 *   actorId: userId,
 *   kind: 'event:created',
 *   targetId: created.id,
 *   targetType: 'event',
 *   extraPayload: { targetTitle: created.title },
 * }, req.log);
 * ```
 *
 * Le helper merge les champs résolus (`actorName`, `groupName`) avec
 * `extraPayload` pour produire le payload final. En cas d'échec du lookup
 * OU de l'insert, on log + continue silencieusement (best-effort).
 */
export async function recordActivityWithLookup(
  input: {
    groupId: string;
    actorId: string | null;
    kind: ActivityKind;
    targetId: string | null;
    targetType: ActivityTargetType;
    /** Champs supplémentaires à merger dans le payload (ex : targetTitle, rsvp, amountCents). */
    extraPayload?: ActivityPayload;
  },
  logger?: { warn: (msg: string, err?: unknown) => void },
): Promise<void> {
  try {
    const db = getDb();
    // Single SELECT JOIN pour résoudre les deux noms en une round trip.
    // LEFT JOIN sur users car actorId peut être null (action système).
    const [resolved] = await db
      .select({
        groupName: groups.name,
        actorName: users.displayName,
      })
      .from(groups)
      .leftJoin(users, eq(users.id, input.actorId ?? sqlNull()))
      .where(eq(groups.id, input.groupId))
      .limit(1);

    const payload: ActivityPayload = {
      ...(resolved?.actorName ? { actorName: resolved.actorName } : {}),
      ...(resolved?.groupName ? { groupName: resolved.groupName } : {}),
      ...(input.extraPayload ?? {}),
    };

    await recordActivity({
      groupId: input.groupId,
      actorId: input.actorId,
      kind: input.kind,
      targetId: input.targetId,
      targetType: input.targetType,
      payload,
    });
  } catch (err) {
    if (logger) {
      logger.warn(`[activity] recordWithLookup failed (kind=${input.kind})`, err);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[activity] recordWithLookup failed (kind=${input.kind})`, err);
    }
  }
}

/**
 * Petit helper interne pour gérer le cas actorId=null dans le LEFT JOIN.
 * Drizzle ne nous laisse pas faire `eq(users.id, null)` directement car
 * `null` n'est pas un type uuid. On retourne un uuid impossible (zeros).
 * Le LEFT JOIN ne matchera pas → resolved.actorName = null. OK.
 */
function sqlNull(): string {
  return '00000000-0000-0000-0000-000000000000';
}

export interface ListActivityFilter {
  /** User pour qui on filtre (membership-anti-leak via INNER JOIN group_members). */
  userId: string;
  /** Filtre optionnel par groupe spécifique. Doit être un groupe dont l'user est membre. */
  groupId?: string;
  /** Cursor ISO timestamp. Renvoie les items strictement plus anciens. */
  cursor?: string;
  /** Limite par page. Default ACTIVITY_DEFAULT_LIMIT (20). */
  limit?: number;
}

export interface ListActivityRow {
  id: string;
  groupId: string;
  groupName: string;
  actorId: string | null;
  kind: string;
  targetId: string | null;
  targetType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface ListActivityResult {
  rows: ListActivityRow[];
  nextCursor: string | null;
}

/**
 * Liste paginée de l'activité visible par l'user.
 *
 * Filtrage anti-leak via INNER JOIN sur group_members → impossible de
 * remonter une activité d'un groupe étranger même avec un groupId forgé
 * (le JOIN ne matche pas).
 *
 * Tri : created_at DESC. La pagination est cursor-based (created_at strict
 * lt cursor pour éviter le drift en cas d'insertion concurrente entre
 * deux pages).
 */
export async function listActivity(filter: ListActivityFilter): Promise<ListActivityResult> {
  const db = getDb();
  const limit = filter.limit ?? ACTIVITY_DEFAULT_LIMIT;
  // Demande `limit + 1` pour savoir s'il y a une page suivante sans count(*).
  const fetchSize = limit + 1;

  const conditions = [eq(groupMembers.userId, filter.userId)];
  if (filter.groupId) conditions.push(eq(activityLog.groupId, filter.groupId));
  if (filter.cursor) conditions.push(lt(activityLog.createdAt, new Date(filter.cursor)));

  const rows = await db
    .select({
      id: activityLog.id,
      groupId: activityLog.groupId,
      groupName: groups.name,
      actorId: activityLog.actorId,
      kind: activityLog.kind,
      targetId: activityLog.targetId,
      targetType: activityLog.targetType,
      payload: activityLog.payload,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .innerJoin(groups, eq(groups.id, activityLog.groupId))
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, activityLog.groupId), eq(groupMembers.userId, filter.userId)),
    )
    .where(and(...conditions))
    .orderBy(desc(activityLog.createdAt))
    .limit(fetchSize);

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    // Le N+1ème indique qu'il y a au moins une page suivante. On ne le
    // renvoie pas, mais on prend son created_at comme cursor — non, plutôt
    // le created_at du dernier item RETOURNÉ (row[limit - 1]) pour que la
    // page suivante reprenne strictement après lui.
    const last = rows[limit - 1];
    if (last) nextCursor = last.createdAt.toISOString();
    rows.pop();
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      groupName: r.groupName,
      actorId: r.actorId,
      kind: r.kind,
      targetId: r.targetId,
      targetType: r.targetType,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt,
    })),
    nextCursor,
  };
}

