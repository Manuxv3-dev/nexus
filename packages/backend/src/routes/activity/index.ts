/**
 * Routes Activity (cf. ADR-029).
 *
 * Endpoint :
 *   GET /api/v1/activity-feed?groupId=...&cursor=...&limit=...
 *
 * Pas de POST public : les entrées sont insérées exclusivement par les
 * routes mutation via le helper `recordActivitySafely` (events / polls /
 * expenses / todos / groups). Le helper est exposé depuis
 * `routes/activity/repo.ts` pour usage interne.
 *
 * Aucune mutation = pas de CSRF requis (l'access token Bearer suffit).
 */
import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';

import { listActivity, type ListActivityRow } from './repo.js';
import {
  ActivityFeedQuerySchema,
  ActivityFeedReplySchema,
  ActivityKindSchema,
  ActivityTargetTypeSchema,
  type ActivityItem,
} from './schemas.js';

import type { FastifyPluginAsync } from 'fastify';

function toDto(r: ListActivityRow): ActivityItem {
  // Validation lâche : on parse pour s'assurer que les enum kind/targetType
  // sont valides au cas où la DB contiendrait des valeurs orphelines (ex :
  // ancienne version qui aurait écrit un kind retiré). Si parse échoue, on
  // skip la ligne via un cast → ne pas casser le payload entier.
  const kindParse = ActivityKindSchema.safeParse(r.kind);
  const targetTypeParse = ActivityTargetTypeSchema.safeParse(r.targetType);
  return {
    id: r.id,
    groupId: r.groupId,
    groupName: r.groupName,
    actorId: r.actorId,
    kind: kindParse.success ? kindParse.data : (r.kind as ActivityItem['kind']),
    targetId: r.targetId,
    targetType: targetTypeParse.success
      ? targetTypeParse.data
      : (r.targetType as ActivityItem['targetType']),
    payload: r.payload as ActivityItem['payload'],
    createdAt: r.createdAt.toISOString(),
  };
}

export const activityPlugin: FastifyPluginAsync = async (app) => {
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/activity-feed',
      query: ActivityFeedQuerySchema,
      reply: ActivityFeedReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const filter: Parameters<typeof listActivity>[0] = { userId };
        if (req.query.groupId !== undefined) filter.groupId = req.query.groupId;
        if (req.query.cursor !== undefined) filter.cursor = req.query.cursor;
        if (req.query.limit !== undefined) filter.limit = req.query.limit;

        const result = await listActivity(filter);
        return {
          items: result.rows.map(toDto),
          nextCursor: result.nextCursor,
        };
      },
    }),
  );
};
