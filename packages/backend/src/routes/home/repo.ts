/**
 * Repo Home — agrégation trans-groupes pour le feed personnel (cf. ADR-024).
 *
 * 5 fonctions indépendantes, chacune renvoyant directement le DTO. Le handler
 * route les exécute en parallèle (`Promise.all`) pour réduire la latence
 * end-to-end : sur les 5 sections, aucune ne dépend des autres.
 *
 * Toutes les queries filtrent par `userId` côté SQL — pas de raisonnement
 * d'autorisation côté JS, ce qui ferme la classe d'erreurs « j'ai oublié
 * de filtrer par membership ».
 */
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { getDb } from '../../db/client.js';
import {
  eventRsvps,
  events,
  expenseShares,
  expenses,
  groupMembers,
  groups,
  notifications,
  pollOptions,
  pollVotes,
  polls,
  todoItems,
  todoLists,
  users,
} from '../../db/schema/index.js';

import {
  HOME_LIMITS,
  type HomeAssignedTodoDto,
  type HomeGroupUnreadCountDto,
  type HomePendingPollDto,
  type HomePendingRsvpDto,
  type HomeUnsettledExpenseDto,
  type HomeUpcomingEventDto,
} from './schemas.js';

/**
 * Events des groupes du user, à venir, pour lesquels il n'a pas encore RSVP.
 *
 * NB : on filtre la membership via INNER JOIN sur group_members → impossible
 * de remonter un event d'un groupe étranger même par accident.
 */
export async function listPendingRsvps(userId: string): Promise<HomePendingRsvpDto[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      groupId: events.groupId,
      groupName: groups.name,
    })
    .from(events)
    .innerJoin(groups, eq(groups.id, events.groupId))
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, events.groupId), eq(groupMembers.userId, userId)),
    )
    .leftJoin(
      eventRsvps,
      and(eq(eventRsvps.eventId, events.id), eq(eventRsvps.userId, userId)),
    )
    .where(and(gt(events.startsAt, sql`now()`), isNull(eventRsvps.userId)))
    .orderBy(asc(events.startsAt))
    .limit(HOME_LIMITS.pendingRsvps);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: r.startsAt.toISOString(),
    groupId: r.groupId,
    groupName: r.groupName,
  }));
}

/**
 * Mes parts non réglées (j'ai une expense_share avec is_settled=false), en
 * excluant les dépenses où je suis le payeur (auquel cas c'est moi qu'on doit).
 *
 * Tri : dépenses les plus récentes d'abord (attention émotionnelle plus forte).
 */
export async function listUnsettledExpenses(
  userId: string,
): Promise<HomeUnsettledExpenseDto[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      amountCents: expenses.amountCents,
      shareCents: expenseShares.shareCents,
      currency: expenses.currency,
      paidById: expenses.paidBy,
      paidByName: users.displayName,
      groupId: expenses.groupId,
      groupName: groups.name,
      createdAt: expenses.createdAt,
    })
    .from(expenseShares)
    .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .innerJoin(users, eq(users.id, expenses.paidBy))
    .where(
      and(
        eq(expenseShares.userId, userId),
        eq(expenseShares.isSettled, false),
        sql`${expenses.paidBy} <> ${userId}`,
      ),
    )
    .orderBy(desc(expenses.createdAt))
    .limit(HOME_LIMITS.unsettledExpenses);

  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    amountCents: r.amountCents,
    shareCents: r.shareCents,
    currency: r.currency,
    paidById: r.paidById,
    paidByName: r.paidByName,
    groupId: r.groupId,
    groupName: r.groupName,
  }));
}

/** Items de todo assignés à moi, encore à faire. */
export async function listAssignedTodos(userId: string): Promise<HomeAssignedTodoDto[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: todoItems.id,
      text: todoItems.text,
      listId: todoLists.id,
      listTitle: todoLists.title,
      groupId: todoLists.groupId,
      groupName: groups.name,
      createdAt: todoItems.createdAt,
    })
    .from(todoItems)
    .innerJoin(todoLists, eq(todoLists.id, todoItems.listId))
    .innerJoin(groups, eq(groups.id, todoLists.groupId))
    .where(and(eq(todoItems.assigneeId, userId), eq(todoItems.done, false)))
    .orderBy(desc(todoItems.createdAt))
    .limit(HOME_LIMITS.assignedTodos);

  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    listId: r.listId,
    listTitle: r.listTitle,
    groupId: r.groupId,
    groupName: r.groupName,
  }));
}

/** Mes events confirmés (RSVP yes) à venir, tri chronologique. */
export async function listUpcomingEvents(userId: string): Promise<HomeUpcomingEventDto[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      location: events.location,
      groupId: events.groupId,
      groupName: groups.name,
    })
    .from(events)
    .innerJoin(
      eventRsvps,
      and(eq(eventRsvps.eventId, events.id), eq(eventRsvps.userId, userId)),
    )
    .innerJoin(groups, eq(groups.id, events.groupId))
    .where(and(eq(eventRsvps.value, 'yes'), gt(events.startsAt, sql`now()`)))
    .orderBy(asc(events.startsAt))
    .limit(HOME_LIMITS.upcomingEvents);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: r.startsAt.toISOString(),
    location: r.location,
    groupId: r.groupId,
    groupName: r.groupName,
  }));
}

/**
 * Sondages des groupes du user, encore ouverts (closes_at null OU futur),
 * pour lesquels le user n'a pas encore voté (aucune ligne dans poll_votes).
 *
 * Tri : sondages les plus récemment créés d'abord — un sondage qui vient
 * d'être ouvert mérite plus d'attention.
 *
 * NB : on filtre la membership via INNER JOIN sur group_members (idem
 * pendingRsvps). Le optionCount est calculé via sous-requête corrélée
 * (volume cible: top 5, donc N+1 acceptable).
 */
export async function listPendingPolls(userId: string): Promise<HomePendingPollDto[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: polls.id,
      question: polls.question,
      closesAt: polls.closesAt,
      groupId: polls.groupId,
      groupName: groups.name,
      createdAt: polls.createdAt,
      optionCount: sql<number>`(SELECT count(*)::int FROM ${pollOptions} WHERE ${pollOptions.pollId} = ${polls.id})`,
    })
    .from(polls)
    .innerJoin(groups, eq(groups.id, polls.groupId))
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, polls.groupId), eq(groupMembers.userId, userId)),
    )
    .leftJoin(
      pollVotes,
      and(eq(pollVotes.pollId, polls.id), eq(pollVotes.userId, userId)),
    )
    .where(
      and(
        isNull(pollVotes.userId),
        or(isNull(polls.closesAt), gt(polls.closesAt, sql`now()`)),
      ),
    )
    .orderBy(desc(polls.createdAt))
    .limit(HOME_LIMITS.pendingPolls);

  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    closesAt: r.closesAt ? r.closesAt.toISOString() : null,
    optionCount: r.optionCount,
    groupId: r.groupId,
    groupName: r.groupName,
  }));
}

/**
 * Compteur de notifications unread, agrégé par groupe.
 *
 * Pas de LIMIT : un user appartient typiquement à <20 groupes, on remonte
 * tout. Le front trie par count décroissant côté JS (la pression de tri en
 * SQL n'apporte rien à ce volume).
 */
export async function listUnreadByGroup(userId: string): Promise<HomeGroupUnreadCountDto[]> {
  const db = getDb();
  const rows = await db
    .select({
      groupId: notifications.groupId,
      groupName: groups.name,
      count: sql<number>`count(*)::int`,
    })
    .from(notifications)
    .innerJoin(groups, eq(groups.id, notifications.groupId))
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .groupBy(notifications.groupId, groups.name);

  return rows
    .filter((r): r is typeof r & { groupId: string } => r.groupId !== null)
    .map((r) => ({ groupId: r.groupId, groupName: r.groupName, count: r.count }));
}
