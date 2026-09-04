/**
 * Routes Home — feed personnel trans-groupes (cf. ADR-024).
 *
 * Endpoints :
 *   GET /api/v1/home/feed
 *
 * Le feed agrège 6 sections (RSVP en attente, dépenses à régler, mes tâches,
 * mes prochains events, les events de la semaine, notifs unread par groupe).
 * Aucune mutation, donc pas de CSRF requis (l'access token Bearer suffit,
 * cf. ADR-015).
 *
 * Perf : les queries SQL sont parallélisées via Promise.all → 1 RTT logique.
 */
import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';

import {
  listAssignedTodos,
  listPendingPolls,
  listPendingRsvps,
  listUnreadByGroup,
  listUnsettledExpenses,
  listUpcomingEvents,
  listWeekEvents,
} from './repo.js';
import { HomeFeedQuerySchema, HomeFeedReplySchema } from './schemas.js';

/**
 * Semaine courante Lundi 00:00 → Lundi suivant 00:00, dans le fuseau du
 * serveur.
 *
 * Fallback uniquement : la définition qui fait foi est celle du client, qui
 * passe ses bornes en query (cf. `HomeFeedQuerySchema`). Ce calcul-ci ne sert
 * qu'aux appelants qui ne les envoient pas — les builds desktop déjà installés,
 * qui embarquent une copie figée de `@nexus/web`. Un décalage de fuseau y est
 * préférable à un 400 sur toute la Home.
 */
function serverWeekBounds(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  // getDay() : 0 = dimanche → 6 = samedi. On le ramène à un offset depuis lundi.
  const dayOfWeek = start.getDay();
  start.setDate(start.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

export const homePlugin: FastifyPluginAsync = async (app) => {
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/home/feed',
      query: HomeFeedQuerySchema,
      reply: HomeFeedReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const { weekStart, weekEnd } = req.query;
        const week =
          weekStart && weekEnd
            ? { start: new Date(weekStart), end: new Date(weekEnd) }
            : serverWeekBounds();

        const [
          pendingRsvps,
          unsettledExpenses,
          assignedTodos,
          upcomingEvents,
          weekEvents,
          pendingPolls,
          unreadByGroup,
        ] = await Promise.all([
          listPendingRsvps(userId),
          listUnsettledExpenses(userId),
          listAssignedTodos(userId),
          listUpcomingEvents(userId),
          listWeekEvents(userId, week.start, week.end),
          listPendingPolls(userId),
          listUnreadByGroup(userId),
        ]);

        return {
          pendingRsvps,
          unsettledExpenses,
          assignedTodos,
          upcomingEvents,
          weekEvents,
          pendingPolls,
          unreadByGroup,
        };
      },
    }),
  );
};
