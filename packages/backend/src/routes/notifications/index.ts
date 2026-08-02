/**
 * Routes Notifications — lecture + marquage lu (cf. ADR-023, J5b V1.2).
 *
 * Endpoints :
 *   GET  /api/v1/notifications?unread=true&cursor=...&limit=...
 *   POST /api/v1/notifications/:notificationId/read
 *   POST /api/v1/notifications/read-all
 *
 * Pas de POST de création public — les notifs sont insérées exclusivement
 * par les producteurs internes (worker event-reminders, hooks routes
 * mutations). Cf. lot C2 pour le câblage des producteurs.
 */
import type { NotificationKind } from '@nexus/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import type { Notification, UserNotifPrefs } from '../../db/schema/index.js';

import { getOrCreatePrefs, updatePrefs } from './prefs-repo.js';
import {
  countUnreadForUser,
  deleteAllNotificationsForUser,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from './repo.js';
import {
  ListNotificationsQuerySchema,
  MarkReadReplySchema,
  NotificationIdParamsSchema,
  NotificationListReplySchema,
  NotificationPrefsReplySchema,
  UpdateNotificationPrefsBodySchema,
  type NotificationDto,
} from './schemas.js';

// ─────────────────────────── Mappers ────────────────────────────────────

function toDto(n: Notification): NotificationDto {
  return {
    id: n.id,
    kind: n.kind as NotificationKind,
    payload: (n.payload as Record<string, unknown>) ?? {},
    groupId: n.groupId,
    sourceId: n.sourceId,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
  };
}

function prefsToDto(p: UserNotifPrefs) {
  return {
    eventReminder: p.eventReminder,
    eventRsvpRequested: p.eventRsvpRequested,
    eventRsvpReceived: p.eventRsvpReceived,
    expenseAdded: p.expenseAdded,
    todoAssigned: p.todoAssigned,
    todoCompleted: p.todoCompleted,
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─────────────────────────── Plugin ─────────────────────────────────────

export const notificationsPlugin: FastifyPluginAsync = async (app) => {
  // ----- GET /api/v1/notifications --------------------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/notifications',
      query: ListNotificationsQuerySchema,
      reply: NotificationListReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user!.id;
        const filter: Parameters<typeof listNotificationsForUser>[1] = {};
        if (req.query.unread === true) filter.unread = true;
        if (req.query.cursor !== undefined) filter.cursor = req.query.cursor;
        if (req.query.limit !== undefined) filter.limit = req.query.limit;

        const [list, unreadCount] = await Promise.all([
          listNotificationsForUser(userId, filter),
          countUnreadForUser(userId),
        ]);

        return {
          notifications: list.notifications.map(toDto),
          unreadCount,
          nextCursor: list.nextCursor,
        };
      },
    }),
  );

  // ----- POST /api/v1/notifications/:notificationId/read ----------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/notifications/:notificationId/read',
      params: NotificationIdParamsSchema,
      body: z.object({}).optional(),
      reply: MarkReadReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user!.id;
        const ok = await markNotificationRead(req.params.notificationId, userId);
        // Anti-leak : si la notif n'existe pas OU appartient à un autre user,
        // on retourne pareil (markedCount=0). Pas de 404 pour ne pas leak.
        return { ok: true as const, markedCount: ok ? 1 : 0 };
      },
    }),
  );

  // ----- POST /api/v1/notifications/read-all ----------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      body: z.object({}).optional(),
      reply: MarkReadReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user!.id;
        const count = await markAllNotificationsRead(userId);
        return { ok: true as const, markedCount: count };
      },
    }),
  );

  // ----- DELETE /api/v1/notifications -----------------------------------
  // "Vider la liste" — supprime TOUTES les notifs (read + unread) du user.
  // Action utilisateur explicite, irréversible. Les events/expenses/todos
  // sous-jacents sont préservés ; seul l'historique de notifs disparaît.
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/notifications',
      reply: z.object({
        ok: z.literal(true),
        deletedCount: z.number().int().nonnegative(),
      }),
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user!.id;
        const count = await deleteAllNotificationsForUser(userId);
        return { ok: true as const, deletedCount: count };
      },
    }),
  );

  // ----- GET /api/v1/notifications/preferences --------------------------
  // Préférences de notif du user (1 bool/kind). Crée la ligne all-true
  // paresseusement si absente. Cf. ADR-034.
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/notifications/preferences',
      reply: NotificationPrefsReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const prefs = await getOrCreatePrefs(req.user!.id);
        return { preferences: prefsToDto(prefs) };
      },
    }),
  );

  // ----- PATCH /api/v1/notifications/preferences ------------------------
  // Update partiel des booléens (clés inconnues rejetées). Upsert.
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      body: UpdateNotificationPrefsBodySchema,
      reply: NotificationPrefsReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const prefs = await updatePrefs(req.user!.id, req.body);
        return { preferences: prefsToDto(prefs) };
      },
    }),
  );
};

/* AppError import garde — utilisé en helper interne potentiel V2. */
void AppError;
