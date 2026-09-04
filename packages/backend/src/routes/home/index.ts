/**
 * Routes Home — feed personnel trans-groupes (cf. ADR-024).
 *
 * Endpoints :
 *   GET /api/v1/home/feed
 *
 * Le feed agrège 7 sections (RSVP en attente, dépenses à régler, mes tâches,
 * mes prochains events, les events de la semaine, sondages en attente, notifs
 * unread par groupe). Aucune mutation, donc pas de CSRF requis (l'access token
 * Bearer suffit, cf. ADR-015).
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

        // Sans bornes, pas de semaine à rendre — et surtout personne pour la
        // lire : les seuls appelants qui les omettent sont les builds desktop
        // figés, dont la copie de `@nexus/web` ne connaît pas `weekEvents` et
        // le strippe au parse. Calculer une semaine « au mieux » côté serveur
        // reviendrait à faire une requête SQL de plus par poll, toutes les 60 s
        // et pour tout le parc installé, dont le résultat serait jeté.
        // Le contrat reste : la fenêtre est opt-in, l'absence de bornes vaut
        // section vide — jamais un 400 qui casserait toute leur Home.
        const { weekStart, weekEnd } = req.query;
        const week =
          weekStart && weekEnd ? { start: new Date(weekStart), end: new Date(weekEnd) } : null;

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
          week ? listWeekEvents(userId, week.start, week.end) : [],
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
