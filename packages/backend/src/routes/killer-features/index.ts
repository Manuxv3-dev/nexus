import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import { requireGroupMembership } from '../../core/middlewares/require-group-membership.js';

import {
  ExpenseSchema,
  GroupIdParamsSchema,
  ListEventsReplySchema,
  ListExpensesReplySchema,
  ListPollsReplySchema,
  ListTodosReplySchema,
  PollSchema,
  SlugParamsSchema,
  TodoListSchema,
} from './schemas.js';
import {
  computeBalances,
  getEventBySlug,
  getExpenseBySlug,
  getPollBySlug,
  getTodoBySlug,
  listEvents,
  listExpenses,
  listPolls,
  listTodos,
} from './store.js';
import { EventSchema as EventReplySchema } from './schemas.js';

/**
 * Plugin Fastify killer features — STUB J4b.
 *
 * Ces endpoints servent de contrat pour le client web (cf. ADR-014). Les
 * vraies implémentations (CRUD complet, persistance Drizzle, propagation WS,
 * pages publiques avec OG cards générées dynamiquement) viendront en J5.
 *
 * Cf. .agent/backlog.md → "J5 : remplacer le store in-memory + ajouter
 * mutations RSVP / vote / expense add / todo CRUD + WS events".
 */
export const killerFeaturesPlugin: FastifyPluginAsync = async (app) => {
  // ───────── Events ─────────
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/events',
      params: GroupIdParamsSchema,
      reply: ListEventsReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const { groupId } = req.params as { groupId: string };
        return { events: listEvents(groupId) };
      },
    }),
  );

  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/public/events/:slug',
      params: SlugParamsSchema,
      reply: EventReplySchema,
      handler: async (req) => {
        const { slug } = req.params as { slug: string };
        const ev = getEventBySlug(slug);
        if (!ev) throw new AppError('RESOURCE_NOT_FOUND');
        return ev;
      },
    }),
  );

  // ───────── Polls ─────────
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/polls',
      params: GroupIdParamsSchema,
      reply: ListPollsReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const { groupId } = req.params as { groupId: string };
        return { polls: listPolls(groupId) };
      },
    }),
  );

  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/public/polls/:slug',
      params: SlugParamsSchema,
      reply: PollSchema,
      handler: async (req) => {
        const { slug } = req.params as { slug: string };
        const p = getPollBySlug(slug);
        if (!p) throw new AppError('RESOURCE_NOT_FOUND');
        return p;
      },
    }),
  );

  // ───────── Expenses ─────────
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/expenses',
      params: GroupIdParamsSchema,
      reply: ListExpensesReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const { groupId } = req.params as { groupId: string };
        return {
          expenses: listExpenses(groupId),
          balances: computeBalances(groupId),
        };
      },
    }),
  );

  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/public/expenses/:slug',
      params: SlugParamsSchema,
      reply: ExpenseSchema,
      handler: async (req) => {
        const { slug } = req.params as { slug: string };
        const e = getExpenseBySlug(slug);
        if (!e) throw new AppError('RESOURCE_NOT_FOUND');
        return e;
      },
    }),
  );

  // ───────── Todos ─────────
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/todos',
      params: GroupIdParamsSchema,
      reply: ListTodosReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const { groupId } = req.params as { groupId: string };
        return { lists: listTodos(groupId) };
      },
    }),
  );

  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/public/todos/:slug',
      params: SlugParamsSchema,
      reply: TodoListSchema,
      handler: async (req) => {
        const { slug } = req.params as { slug: string };
        const t = getTodoBySlug(slug);
        if (!t) throw new AppError('RESOURCE_NOT_FOUND');
        return t;
      },
    }),
  );
};
