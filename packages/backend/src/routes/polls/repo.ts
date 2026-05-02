/**
 * Repository Polls — accès Drizzle aux tables `polls`, `poll_options`,
 * `poll_votes`.
 *
 * Convention vote :
 *  - `multi: false` (single choice) → un user ne peut voter que pour 1
 *    option d'un poll. Si on vote pour une autre, le précédent est purgé.
 *  - `multi: true` → un user peut voter pour plusieurs options. Toggle
 *    indépendant.
 *
 * La gestion `closes_at` (refuser les votes après clôture) est faite côté
 * service (`vote()` throw RESOURCE_CONFLICT si poll clos).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors.js';
import { generateSlug } from '../../core/slug-generator.js';
import { getDb } from '../../db/client.js';
import {
  pollOptions,
  pollVotes,
  polls,
  type NewPoll,
  type Poll,
  type PollOption,
} from '../../db/schema/index.js';

// ─────────────────────────── Types ──────────────────────────────────────

export interface PollOptionWithVoters extends PollOption {
  voters: string[];
}

export interface PollWithOptions extends Poll {
  options: PollOptionWithVoters[];
}

export interface CreatePollInput {
  groupId: string;
  channelId?: string | null;
  tags?: string[];
  question: string;
  multi?: boolean;
  closesAt?: Date | null;
  options: string[];
  createdBy: string;
}

export interface UpdatePollInput {
  channelId?: string | null;
  tags?: string[];
  question?: string;
  multi?: boolean;
  closesAt?: Date | null;
}

// ─────────────────────────── Mutations ───────────────────────────────────

export async function createPoll(input: CreatePollInput): Promise<PollWithOptions> {
  const db = getDb();
  const slug = generateSlug();
  const insert: NewPoll = {
    slug,
    groupId: input.groupId,
    channelId: input.channelId ?? null,
    tags: input.tags ?? [],
    question: input.question,
    multi: input.multi ?? false,
    closesAt: input.closesAt ?? null,
    createdBy: input.createdBy,
  };
  // Insertion en transaction pour garantir poll + options atomique.
  const result = await db.transaction(async (tx) => {
    const [pollRow] = await tx.insert(polls).values(insert).returning();
    if (!pollRow) throw new Error('insert poll failed');
    if (input.options.length > 0) {
      await tx.insert(pollOptions).values(
        input.options.map((label, i) => ({
          pollId: pollRow.id,
          label,
          position: i,
        })),
      );
    }
    return pollRow;
  });
  const full = await getPollById(result.id);
  if (!full) throw new Error('poll vanished after insert');
  return full;
}

export async function updatePoll(
  id: string,
  patch: UpdatePollInput,
): Promise<Poll | undefined> {
  const db = getDb();
  const set: Partial<NewPoll> & { updatedAt: Date } = { updatedAt: new Date() };
  if (patch.channelId !== undefined) set.channelId = patch.channelId;
  if (patch.tags !== undefined) set.tags = patch.tags;
  if (patch.question !== undefined) set.question = patch.question;
  if (patch.multi !== undefined) set.multi = patch.multi;
  if (patch.closesAt !== undefined) set.closesAt = patch.closesAt;
  const [row] = await db.update(polls).set(set).where(eq(polls.id, id)).returning();
  return row;
}

export async function deletePoll(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(polls).where(eq(polls.id, id)).returning({ id: polls.id });
  return result.length > 0;
}

/**
 * Toggle un vote.
 *  - `value === true`  → ajoute le vote pour cette option (en mode single,
 *    purge les autres votes du user pour ce poll).
 *  - `value === false` → retire le vote.
 *
 * Refuse si le poll est clos. Touch `polls.updated_at` pour invalidation
 * cache OG.
 */
export async function vote(
  pollId: string,
  optionId: string,
  userId: string,
  value: boolean,
): Promise<void> {
  const db = getDb();
  const [poll] = await db.select().from(polls).where(eq(polls.id, pollId)).limit(1);
  if (!poll) throw new AppError('RESOURCE_NOT_FOUND', { pollId });
  if (poll.closesAt && poll.closesAt.getTime() <= Date.now()) {
    throw new AppError('RESOURCE_CONFLICT', { reason: 'poll_closed' });
  }
  // Vérifie que l'option appartient bien au poll (anti-cross-poll vote).
  const [opt] = await db
    .select({ id: pollOptions.id })
    .from(pollOptions)
    .where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, pollId)))
    .limit(1);
  if (!opt) throw new AppError('RESOURCE_NOT_FOUND', { reason: 'option_not_in_poll' });

  await db.transaction(async (tx) => {
    if (value) {
      if (!poll.multi) {
        // Single choice : purge les autres votes de l'user pour ce poll.
        await tx
          .delete(pollVotes)
          .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, userId)));
      }
      await tx
        .insert(pollVotes)
        .values({ pollId, optionId, userId })
        .onConflictDoNothing({
          target: [pollVotes.pollId, pollVotes.optionId, pollVotes.userId],
        });
    } else {
      await tx
        .delete(pollVotes)
        .where(
          and(
            eq(pollVotes.pollId, pollId),
            eq(pollVotes.optionId, optionId),
            eq(pollVotes.userId, userId),
          ),
        );
    }
    await tx.update(polls).set({ updatedAt: new Date() }).where(eq(polls.id, pollId));
  });
}

// ─────────────────────────── Lectures ────────────────────────────────────

export async function getPollById(id: string): Promise<PollWithOptions | null> {
  const db = getDb();
  const [pollRow] = await db.select().from(polls).where(eq(polls.id, id)).limit(1);
  if (!pollRow) return null;
  return hydrate(pollRow);
}

export async function getPollBySlug(slug: string): Promise<PollWithOptions | null> {
  const db = getDb();
  const [pollRow] = await db.select().from(polls).where(eq(polls.slug, slug)).limit(1);
  if (!pollRow) return null;
  return hydrate(pollRow);
}

async function hydrate(pollRow: Poll): Promise<PollWithOptions> {
  const db = getDb();
  const opts = await db
    .select()
    .from(pollOptions)
    .where(eq(pollOptions.pollId, pollRow.id))
    .orderBy(asc(pollOptions.position));
  const optIds = opts.map((o) => o.id);
  const votes =
    optIds.length === 0
      ? []
      : await db.select().from(pollVotes).where(inArray(pollVotes.optionId, optIds));
  const votersByOption = new Map<string, string[]>();
  for (const v of votes) {
    const list = votersByOption.get(v.optionId) ?? [];
    list.push(v.userId);
    votersByOption.set(v.optionId, list);
  }
  return {
    ...pollRow,
    options: opts.map((o) => ({ ...o, voters: votersByOption.get(o.id) ?? [] })),
  };
}

export interface ListPollsFilter {
  /** 'open' = closesAt null OR closesAt > now ; 'closed' = closesAt <= now ; 'all' */
  state?: 'open' | 'closed' | 'all';
  channelId?: string;
}

export async function listPollsByGroup(
  groupId: string,
  filter: ListPollsFilter = {},
): Promise<PollWithOptions[]> {
  const db = getDb();
  const state = filter.state ?? 'all';
  const conditions = [eq(polls.groupId, groupId)];
  if (state === 'open') {
    conditions.push(sql`(${polls.closesAt} IS NULL OR ${polls.closesAt} > now())`);
  } else if (state === 'closed') {
    conditions.push(sql`${polls.closesAt} <= now()`);
  }
  if (filter.channelId) {
    conditions.push(eq(polls.channelId, filter.channelId));
  }
  const rows = await db
    .select()
    .from(polls)
    .where(and(...conditions))
    .orderBy(asc(polls.createdAt));
  if (rows.length === 0) return [];

  // Bulk hydration : on charge toutes les options + tous les votes en 2 queries.
  const pollIds = rows.map((r) => r.id);
  const allOptions = await db
    .select()
    .from(pollOptions)
    .where(inArray(pollOptions.pollId, pollIds))
    .orderBy(asc(pollOptions.position));
  const optionIds = allOptions.map((o) => o.id);
  const allVotes =
    optionIds.length === 0
      ? []
      : await db.select().from(pollVotes).where(inArray(pollVotes.optionId, optionIds));

  const votersByOption = new Map<string, string[]>();
  for (const v of allVotes) {
    const list = votersByOption.get(v.optionId) ?? [];
    list.push(v.userId);
    votersByOption.set(v.optionId, list);
  }
  const optionsByPoll = new Map<string, PollOptionWithVoters[]>();
  for (const o of allOptions) {
    const list = optionsByPoll.get(o.pollId) ?? [];
    list.push({ ...o, voters: votersByOption.get(o.id) ?? [] });
    optionsByPoll.set(o.pollId, list);
  }

  return rows.map((r) => ({ ...r, options: optionsByPoll.get(r.id) ?? [] }));
}
