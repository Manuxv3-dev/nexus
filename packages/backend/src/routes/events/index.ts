/**
 * Routes Events — CRUD + RSVP + lecture publique (cf. J5b #38).
 *
 * Endpoints :
 *   POST   /api/v1/groups/:groupId/events        (membres)
 *   GET    /api/v1/groups/:groupId/events        (membres, query when)
 *   GET    /api/v1/events/:eventId               (membres du group de l'event)
 *   PATCH  /api/v1/events/:eventId               (createdBy ou admin)
 *   DELETE /api/v1/events/:eventId               (createdBy ou admin)
 *   POST   /api/v1/events/:eventId/rsvp          (membres)
 *   GET    /api/v1/public/events/:slug           (public, pas d'auth)
 *
 * Propagation WS via `nexus-event-bus` après chaque mutation.
 * Rappels T-24h / T-1h via le scheduler BullMQ (cf. ADR-020).
 */
import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { getAuthUser, requireAuth } from '../../core/middlewares/require-auth.js';
import {
  requireGroupMembership,
  getGroupContext,
} from '../../core/middlewares/require-group-membership.js';
import { publishNexusEvent } from '../../ws/nexus-event-bus.js';
import { recordActivityWithLookup } from '../activity/repo.js';
import { findMembership, listMembers } from '../groups/service.js';
import { insertNotification, insertNotificationsBulk } from '../notifications/repo.js';

import {
  createEvent,
  deleteEvent,
  getEventById,
  getEventBySlug,
  listEventsByGroup,
  updateEvent,
  upsertRsvp,
  type EventWithRsvps,
} from './repo.js';
import {
  cancelEventReminders,
  rescheduleEventReminders,
  scheduleEventReminders,
} from './scheduler.js';
import {
  CreateEventBodySchema,
  DeleteEventReplySchema,
  EventIdParamsSchema,
  EventListReplySchema,
  EventReplySchema,
  GroupIdParamsSchema,
  ListEventsQuerySchema,
  RsvpBodySchema,
  SlugParamsSchema,
  UpdateEventBodySchema,
  type EventDto,
} from './schemas.js';

// ─────────────────────────── Mappers ────────────────────────────────────

function toDto(e: EventWithRsvps): EventDto {
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

// ─────────────────────────── Plugin ─────────────────────────────────────

export const eventsPlugin: FastifyPluginAsync = async (app) => {
  // ----- POST /groups/:groupId/events --------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups/:groupId/events',
      params: GroupIdParamsSchema,
      body: CreateEventBodySchema,
      reply: EventReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const userId = getAuthUser(req).id;
        const created = await createEvent({
          groupId: ctx.groupId,
          tags: req.body.tags ?? [],
          title: req.body.title,
          description: req.body.description ?? null,
          startsAt: new Date(req.body.startsAt),
          location: req.body.location ?? null,
          createdBy: userId,
        });
        // Programme les rappels T-24h et T-1h (best-effort, ne fail pas la mutation)
        await scheduleEventReminders({ id: created.id, startsAt: created.startsAt });
        await publishNexusEvent({
          type: 'event:created',
          groupId: ctx.groupId,
          timestamp: Date.now(),
          payload: { eventId: created.id },
        });
        // ADR-029 : log d'activité (best-effort, n'échoue pas la mutation).
        await recordActivityWithLookup(
          {
            groupId: ctx.groupId,
            actorId: userId,
            kind: 'event:created',
            targetId: created.id,
            targetType: 'event',
            extraPayload: { targetTitle: created.title },
          },
          req.log,
        );
        // Notifie les members (sauf créateur) qu'on attend leur RSVP.
        try {
          const allMembers = await listMembers(ctx.groupId);
          const recipients = allMembers.filter((m) => m.user.id !== userId);
          if (recipients.length > 0) {
            const creatorName =
              allMembers.find((m) => m.user.id === userId)?.user.displayName ?? "Quelqu'un";
            const notifs = await insertNotificationsBulk(
              recipients.map((m) => ({
                userId: m.user.id,
                kind: 'event_rsvp_requested' as const,
                payload: {
                  eventId: created.id,
                  eventTitle: created.title,
                  startsAt: created.startsAt.toISOString(),
                  createdByName: creatorName,
                },
                groupId: ctx.groupId,
                sourceId: created.id,
              })),
            );
            for (const n of notifs) {
              await publishNexusEvent({
                type: 'notification:created',
                groupId: ctx.groupId,
                timestamp: Date.now(),
                payload: { notificationId: n.id, userId: n.userId, kind: 'event_rsvp_requested' },
              });
            }
          }
        } catch (err) {
          req.log.warn({ err }, 'failed to fan-out event_rsvp_requested notifications');
        }
        const full = await getEventById(created.id);
        if (!full) throw new AppError('INTERNAL_ERROR');
        return { event: toDto(full) };
      },
    }),
  );

  // ----- GET /groups/:groupId/events ---------------------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/events',
      params: GroupIdParamsSchema,
      query: ListEventsQuerySchema,
      reply: EventListReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const filter: { when?: 'upcoming' | 'past' | 'all' } = {};
        if (req.query.when !== undefined) filter.when = req.query.when;
        const list = await listEventsByGroup(ctx.groupId, filter);
        return { events: list.map(toDto) };
      },
    }),
  );

  // ----- GET /events/:eventId ----------------------------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/events/:eventId',
      params: EventIdParamsSchema,
      reply: EventReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const event = await getEventById(req.params.eventId);
        if (!event) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = getAuthUser(req).id;
        const membership = await findMembership(event.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND'); // anti-leak
        return { event: toDto(event) };
      },
    }),
  );

  // ----- PATCH /events/:eventId --------------------------------------------
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/events/:eventId',
      params: EventIdParamsSchema,
      body: UpdateEventBodySchema,
      reply: EventReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getEventById(req.params.eventId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = getAuthUser(req).id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        // MAN-246 : la modification était ouverte à TOUT membre du groupe —
        // seule l'appartenance était vérifiée. N'importe qui pouvait donc
        // réécrire silencieusement le contenu créé par un autre. On aligne sur
        // la règle de DELETE juste en dessous, et sur ce que `expenses` fait
        // déjà des deux côtés : créateur, ou owner/admin du groupe.
        const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin';
        if (existing.createdBy !== userId && !isOwnerOrAdmin) {
          throw new AppError('PERMISSION_DENIED');
        }
        const patch: Parameters<typeof updateEvent>[1] = {};
        if (req.body.tags !== undefined) patch.tags = req.body.tags;
        if (req.body.title !== undefined) patch.title = req.body.title;
        if (req.body.description !== undefined) patch.description = req.body.description;
        if (req.body.startsAt !== undefined) patch.startsAt = new Date(req.body.startsAt);
        if (req.body.location !== undefined) patch.location = req.body.location;
        await updateEvent(req.params.eventId, patch);
        const full = await getEventById(req.params.eventId);
        if (!full) throw new AppError('INTERNAL_ERROR');
        // Re-programme les rappels si `startsAt` a (potentiellement) changé.
        // On reschedule systématiquement plutôt que de comparer : c'est
        // idempotent et négligeable en coût (BullMQ remove + add).
        if (req.body.startsAt !== undefined) {
          await rescheduleEventReminders({ id: full.id, startsAt: full.startsAt });
        }
        await publishNexusEvent({
          type: 'event:updated',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { eventId: existing.id },
        });
        return { event: toDto(full) };
      },
    }),
  );

  // ----- DELETE /events/:eventId -------------------------------------------
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/events/:eventId',
      params: EventIdParamsSchema,
      reply: DeleteEventReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getEventById(req.params.eventId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = getAuthUser(req).id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        // Suppression réservée au créateur ou aux admins/owners du groupe.
        const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin';
        if (existing.createdBy !== userId && !isOwnerOrAdmin) {
          throw new AppError('PERMISSION_DENIED');
        }
        await deleteEvent(req.params.eventId);
        // Annule les rappels en attente (best-effort)
        await cancelEventReminders(req.params.eventId);
        await publishNexusEvent({
          type: 'event:deleted',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { eventId: existing.id },
        });
        // ADR-029 : log d'activité event:cancelled (pas event:deleted — du
        // point de vue UX, l'event est annulé, pas effacé de l'histoire).
        await recordActivityWithLookup(
          {
            groupId: existing.groupId,
            actorId: userId,
            kind: 'event:cancelled',
            targetId: existing.id,
            targetType: 'event',
            extraPayload: { targetTitle: existing.title },
          },
          req.log,
        );
        return { ok: true as const };
      },
    }),
  );

  // ----- POST /events/:eventId/rsvp ----------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/events/:eventId/rsvp',
      params: EventIdParamsSchema,
      body: RsvpBodySchema,
      reply: EventReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getEventById(req.params.eventId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = getAuthUser(req).id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        await upsertRsvp(req.params.eventId, userId, req.body.value);
        await publishNexusEvent({
          type: 'event:rsvp',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { eventId: existing.id, userId, value: req.body.value },
        });
        // ADR-029 : log d'activité event:rsvp:changed. Le rsvp peut être
        // null (= clear), on l'enregistre quand même pour la timeline.
        await recordActivityWithLookup(
          {
            groupId: existing.groupId,
            actorId: userId,
            kind: 'event:rsvp:changed',
            targetId: existing.id,
            targetType: 'event',
            extraPayload: {
              targetTitle: existing.title,
              rsvp: req.body.value ?? 'cleared',
            },
          },
          req.log,
        );
        // Notifie le créateur de l'event quand quelqu'un RSVP (sauf si c'est lui-même).
        req.log.info(
          {
            eventId: existing.id,
            createdBy: existing.createdBy,
            respondent: userId,
            value: req.body.value,
          },
          '[notif-debug] rsvp upsert — should notify creator?',
        );
        if (existing.createdBy !== userId && req.body.value !== null) {
          try {
            const allMembers = await listMembers(existing.groupId);
            const respName =
              allMembers.find((m) => m.user.id === userId)?.user.displayName ?? "Quelqu'un";
            const notif = await insertNotification({
              userId: existing.createdBy,
              kind: 'event_rsvp_received',
              payload: {
                eventId: existing.id,
                eventTitle: existing.title,
                respondentName: respName,
                value: req.body.value,
              },
              groupId: existing.groupId,
              sourceId: existing.id,
            });
            if (notif) {
              await publishNexusEvent({
                type: 'notification:created',
                groupId: existing.groupId,
                timestamp: Date.now(),
                payload: {
                  notificationId: notif.id,
                  userId: notif.userId,
                  kind: 'event_rsvp_received',
                },
              });
            }
          } catch (err) {
            req.log.warn({ err }, 'failed to notify event creator of RSVP');
          }
        }
        const full = await getEventById(req.params.eventId);
        if (!full) throw new AppError('INTERNAL_ERROR');
        return { event: toDto(full) };
      },
    }),
  );

  // ----- GET /public/events/:slug ------------------------------------------
  // Lecture publique : pas d'auth, mais on n'expose pas le `groupId` du DTO
  // pour éviter la fuite d'identifiants internes.
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/public/events/:slug',
      params: SlugParamsSchema,
      reply: EventReplySchema,
      handler: async (req) => {
        const event = await getEventBySlug(req.params.slug);
        if (!event) throw new AppError('RESOURCE_NOT_FOUND');
        return { event: toDto(event) };
      },
    }),
  );
};
