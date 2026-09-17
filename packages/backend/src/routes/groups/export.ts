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
 * collection pour éviter qu'un groupe anormalement gros ne bloque la requête
 * HTTP en silence — au-delà, 413 `EXPORT_TOO_LARGE` plutôt qu'un timeout.
 */
import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  requireGroupMembership,
  requireGroupRole,
} from '../../core/middlewares/require-group-membership.js';
import { listEventsByGroup, type EventWithRsvps } from '../events/repo.js';
import type { EventDto } from '../events/schemas.js';
import { listExpensesByGroup, type ExpenseWithShares } from '../expenses/repo.js';
import type { ExpenseDto } from '../expenses/schemas.js';
import { listPollsByGroup, type PollWithOptions } from '../polls/repo.js';
import type { PollDto } from '../polls/schemas.js';
import { listTodoListsByGroup, type TodoListWithItems } from '../todos/repo.js';
import type { TodoItemDto, TodoListDto } from '../todos/schemas.js';

import { GroupExportSchema, type GroupExport } from './export-schema.js';
import { GroupIdParamsSchema } from './schemas.js';
import { findGroupById, groupToDto, listMembers, memberToDto } from './service.js';

/** Plafond de lignes par collection — au-delà, 413 `EXPORT_TOO_LARGE`. */
export const EXPORT_MAX_ROWS_PER_COLLECTION = 5000;

function assertWithinExportCap(collection: string, count: number): void {
  if (count > EXPORT_MAX_ROWS_PER_COLLECTION) {
    throw new AppError('EXPORT_TOO_LARGE', {
      collection,
      count,
      max: EXPORT_MAX_ROWS_PER_COLLECTION,
    });
  }
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

// ─────────────────────────── Nom de fichier ─────────────────────────────

/**
 * Slug du nom de groupe pour le nom de fichier — les groupes n'ont pas de
 * colonne `slug` en base (contrairement aux events/polls/dépenses/todos),
 * `name` est tout ce dont on dispose. Diacritiques retirés, tout ce qui
 * n'est pas alphanumérique devient un tiret ; replié sur `groupe` si le nom
 * ne laisse rien d'exploitable (ex. un nom 100% emoji).
 */
function slugifyGroupName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'groupe';
}

/** `nexus-<slug-du-groupe>-<AAAAMMJJ>.json` (cf. ticket 645f29ca, décision 2). */
export function exportFilename(groupName: string, exportedAt: string): string {
  const datePart = exportedAt.slice(0, 10).replace(/-/g, '');
  return `nexus-${slugifyGroupName(groupName)}-${datePart}.json`;
}

// ─────────────────────────── Service ────────────────────────────────────

/**
 * Assemble l'export JSON complet d'un groupe.
 *
 * Une requête par collection (bulk-hydratée par son repo, pas de boucle par
 * ligne) — N+1 acceptable pour un export ponctuel, pas un chemin chaud.
 * Chaque collection est bornée par {@link EXPORT_MAX_ROWS_PER_COLLECTION}
 * avant de passer à la suivante, pour couper court dès la première
 * collection hors gabarit plutôt que de tout charger avant de refuser.
 */
export async function buildGroupExport(groupId: string, exportedBy: string): Promise<GroupExport> {
  const group = await findGroupById(groupId);
  if (!group) throw new AppError('RESOURCE_NOT_FOUND');

  const memberRows = await listMembers(groupId);
  assertWithinExportCap('members', memberRows.length);

  const events = await listEventsByGroup(groupId, { when: 'all' });
  assertWithinExportCap('events', events.length);

  const polls = await listPollsByGroup(groupId, { state: 'all' });
  assertWithinExportCap('polls', polls.length);

  const expenses = await listExpensesByGroup(groupId, { state: 'all' });
  assertWithinExportCap('expenses', expenses.length);

  const todoLists = await listTodoListsByGroup(groupId);
  assertWithinExportCap('todoLists', todoLists.length);

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
