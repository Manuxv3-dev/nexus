/**
 * Export JSON d'un groupe — service + route (ticket 645f29ca).
 *
 * RGPD (complète ADR-033 : la suppression de compte ne laissait aucun moyen
 * de récupérer ses données au préalable) et sauvegarde personnelle.
 *
 * Owner/admin uniquement — cf. JSDoc de `exportGroupRoute` : l'export
 * contient les données de TOUS les membres (parts de dépenses, votes, RSVP),
 * pas seulement celles de l'appelant, ce qui dépasse ce qu'un simple membre
 * doit pouvoir extraire d'un coup.
 *
 * Synchrone, pas de job BullMQ : un groupe de bande d'amis tient en
 * quelques centaines de Ko. `EXPORT_MAX_ROWS_PER_COLLECTION` borne chaque
 * collection : un `count(*)` par collection est fait AVANT tout chargement
 * (cf. `countExportCollections`) — un groupe hors gabarit part en 413
 * `EXPORT_TOO_LARGE` sans qu'aucune ligne n'ait été chargée en mémoire, pas
 * même celle qui a déclenché le refus.
 */
import { eq, sql } from 'drizzle-orm';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  requireGroupMembership,
  requireGroupRole,
} from '../../core/middlewares/require-group-membership.js';
import { getDb } from '../../db/client.js';
import {
  events as eventsTable,
  expenses as expensesTable,
  groupMembers as groupMembersTable,
  polls as pollsTable,
  todoLists as todoListsTable,
} from '../../db/schema/index.js';
import { listEventsByGroup, type EventWithRsvps } from '../events/repo.js';
import type { EventDto } from '../events/schemas.js';
import { listExpensesByGroup, type ExpenseWithShares } from '../expenses/repo.js';
import type { ExpenseDto } from '../expenses/schemas.js';
import { listPollsByGroup, type PollWithOptions } from '../polls/repo.js';
import type { PollDto } from '../polls/schemas.js';
import { listTodoListsByGroup, type TodoListWithItems } from '../todos/repo.js';
import type { TodoItemDto, TodoListDto } from '../todos/schemas.js';

import { assertWithinExportCap, exportFilename, type ExportCollection } from './export-pure.js';
import { GroupExportSchema, type GroupExport } from './export-schema.js';
import { GroupIdParamsSchema } from './schemas.js';
import { findGroupById, groupToDto, listMembers, memberToDto } from './service.js';

/**
 * Compte les 5 collections d'un groupe EN PARALLÈLE, sans charger aucune
 * ligne (`count(*)` pur) — appelé avant tout `listXByGroup`, pour que le
 * plafond coupe court avant tout chargement plutôt qu'après (revue #122 : la
 * version précédente mesurait `rows.length` après un chargement complet,
 * contredisant le commentaire qui prétendait déjà couper court).
 */
async function countExportCollections(groupId: string): Promise<Record<ExportCollection, number>> {
  const db = getDb();
  const countOne = async (query: Promise<{ n: number }[]>): Promise<number> =>
    (await query)[0]?.n ?? 0;

  const [members, events, polls, expenses, todoLists] = await Promise.all([
    countOne(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(groupMembersTable)
        .where(eq(groupMembersTable.groupId, groupId)),
    ),
    countOne(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(eventsTable)
        .where(eq(eventsTable.groupId, groupId)),
    ),
    countOne(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(pollsTable)
        .where(eq(pollsTable.groupId, groupId)),
    ),
    countOne(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(expensesTable)
        .where(eq(expensesTable.groupId, groupId)),
    ),
    countOne(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(todoListsTable)
        .where(eq(todoListsTable.groupId, groupId)),
    ),
  ]);

  return { members, events, polls, expenses, todoLists };
}

// ─────────────────────────── Mappers ────────────────────────────────────
// Dupliqués À DESSEIN plutôt que d'exporter/importer les `toDto` privés de
// chaque domaine (events/polls/expenses/todos `index.ts`) : ces fichiers
// sont retouchés en parallèle par la migration DTO vers @nexus/shared
// (ticket 0e8b5905), et un couplage cross-route ici aurait conflicté avec ce
// chantier pour un bénéfice DRY marginal (10-15 lignes par domaine).

function eventToExportDto(e: EventWithRsvps): EventDto {
  return {
    id: e.id,
    slug: e.slug,
    groupId: e.groupId,
    tags: e.tags,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt.toISOString(),
    location: e.location,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    rsvps: e.rsvps,
  };
}

function pollToExportDto(p: PollWithOptions): PollDto {
  return {
    id: p.id,
    slug: p.slug,
    groupId: p.groupId,
    tags: p.tags,
    question: p.question,
    multi: p.multi,
    closesAt: p.closesAt ? p.closesAt.toISOString() : null,
    options: p.options.map((o) => ({
      id: o.id,
      pollId: o.pollId,
      label: o.label,
      position: o.position,
      voters: o.voters,
    })),
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * `shares[].isSettled`/`settledAt` PORTENT le règlement — Nexus ne modélise
 * pas de collection « settlements » séparée, il n'y a pas de table dédiée en
 * base (cf. `db/schema/index.ts`). Documenté tel quel dans
 * `docs/export-format.md`.
 */
function expenseToExportDto(e: ExpenseWithShares): ExpenseDto {
  return {
    id: e.id,
    slug: e.slug,
    groupId: e.groupId,
    tags: e.tags,
    description: e.description,
    amountCents: e.amountCents,
    currency: e.currency,
    paidBy: e.paidBy,
    paidByName: e.payerName,
    settledAt: e.settledAt ? e.settledAt.toISOString() : null,
    shares: e.shares.map((s) => ({
      expenseId: s.expenseId,
      userId: s.userId,
      shareCents: s.shareCents,
      isSettled: s.isSettled,
      settledAt: s.settledAt ? s.settledAt.toISOString() : null,
      userName: s.userName,
    })),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

function todoItemToExportDto(i: TodoListWithItems['items'][number]): TodoItemDto {
  return {
    id: i.id,
    listId: i.listId,
    text: i.text,
    done: i.done,
    assigneeId: i.assigneeId,
    position: i.position,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

function todoListToExportDto(l: TodoListWithItems): TodoListDto {
  return {
    id: l.id,
    slug: l.slug,
    groupId: l.groupId,
    tags: l.tags,
    title: l.title,
    items: l.items.map(todoItemToExportDto),
    createdBy: l.createdBy,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

// ─────────────────────────── Service ────────────────────────────────────

/**
 * Assemble l'export JSON complet d'un groupe.
 *
 * 1. Compte les 5 collections en parallèle (`countExportCollections`,
 *    `count(*)` pur) et vérifie chacune contre le plafond — AVANT tout
 *    chargement. Un groupe hors gabarit part en 413 sans qu'aucune ligne
 *    n'ait été chargée en mémoire (revue #122).
 * 2. Charge chaque collection (une requête par collection, bulk-hydratée par
 *    son repo, pas de boucle par ligne) — N+1 acceptable pour un export
 *    ponctuel, pas un chemin chaud.
 */
export async function buildGroupExport(groupId: string, exportedBy: string): Promise<GroupExport> {
  const group = await findGroupById(groupId);
  if (!group) throw new AppError('RESOURCE_NOT_FOUND');

  const counts = await countExportCollections(groupId);
  assertWithinExportCap('members', counts.members);
  assertWithinExportCap('events', counts.events);
  assertWithinExportCap('polls', counts.polls);
  assertWithinExportCap('expenses', counts.expenses);
  assertWithinExportCap('todoLists', counts.todoLists);

  const memberRows = await listMembers(groupId);
  const events = await listEventsByGroup(groupId, { when: 'all' });
  const polls = await listPollsByGroup(groupId, { state: 'all' });
  const expenses = await listExpensesByGroup(groupId, { state: 'all' });
  const todoLists = await listTodoListsByGroup(groupId);

  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    exportedBy,
    group: groupToDto(group),
    members: memberRows.map(({ member, user }) => memberToDto(member, user)),
    events: events.map(eventToExportDto),
    polls: polls.map(pollToExportDto),
    expenses: expenses.map(expenseToExportDto),
    todoLists: todoLists.map(todoListToExportDto),
  };
}

// ─────────────────────────── Route ──────────────────────────────────────

/**
 * `GET /api/v1/groups/:groupId/export` — export JSON complet d'un groupe.
 *
 * Owner/admin uniquement (403 `PERMISSION_DENIED` sinon, via
 * `requireGroupRole`) : contrairement aux autres lectures scopées groupe,
 * l'export expose les données de TOUS les membres (parts, votes, RSVP), pas
 * seulement celles de l'appelant. `requireGroupMembership` gère en amont le
 * cas non-membre/groupe inexistant (404, anti-leak — cf. son JSDoc).
 *
 * La réponse est validée par `GroupExportSchema` comme toute route
 * `defineRoute` ; `Content-Disposition` est posé à la main sur `reply` (pas
 * un champ du schéma) pour déclencher le téléchargement côté navigateur.
 */
export const exportGroupRoute = defineRoute({
  method: 'GET',
  url: '/api/v1/groups/:groupId/export',
  params: GroupIdParamsSchema,
  reply: GroupExportSchema,
  preHandlers: [requireAuth, requireGroupMembership],
  handler: async (req, reply) => {
    const ctx = requireGroupRole(req, 'admin');
    const userId = req.user?.id;
    if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');

    const data = await buildGroupExport(ctx.groupId, userId);

    reply.header(
      'Content-Disposition',
      `attachment; filename="${exportFilename(data.group.name, data.exportedAt)}"`,
    );
    return data;
  },
});
