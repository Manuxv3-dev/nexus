/**
 * Routes Home — feed personnel trans-groupes (cf. ADR-024).
 *
 * Endpoints :
 *   GET /api/v1/home/feed
 *
 * Le feed agrège 5 sections (RSVP en attente, dépenses à régler, mes tâches,
 * mes prochains events, notifs unread par groupe). Aucune mutation, donc
 * pas de CSRF requis (l'access token Bearer suffit, cf. ADR-015).
 *
 * Perf : 5 queries SQL parallélisées via Promise.all → 1 RTT logique.
 */
import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';

import {
  listAssignedTodos,
  listPendingRsvps,
  listUnreadByGroup,
  listUnsettledExpenses,
  listUpcomingEvents,
} from './repo.js';
import { HomeFeedReplySchema } from './schemas.js';

import type { FastifyPluginAsync } from 'fastify';

export const homePlugin: FastifyPluginAsync = async (app) => {
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/home/feed',
      reply: HomeFeedReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const [pendingRsvps, unsettledExpenses, assignedTodos, upcomingEvents, unreadByGroup] =
          await Promise.all([
            listPendingRsvps(userId),
            listUnsettledExpenses(userId),
            listAssignedTodos(userId),
            listUpcomingEvents(userId),
            listUnreadByGroup(userId),
          ]);

        return {
          pendingRsvps,
          unsettledExpenses,
          assignedTodos,
          upcomingEvents,
          unreadByGroup,
        };
      },
    }),
  );
};
