/**
 * Routes Events — CRUD + RSVP + lecture publique (cf. J5b #38).
 *
 * Endpoints :
 *   POST   /api/v1/groups/:groupId/events        (membres)
 *   GET    /api/v1/groups/:groupId/events        (membres, query when/channelId)
 *   GET    /api/v1/events/:eventId               (membres du group de l'event)
 *   PATCH  /api/v1/events/:eventId               (membres)
 *   DELETE /api/v1/events/:eventId               (createdBy ou admin)
 *   POST   /api/v1/events/:eventId/rsvp          (membres)
 *   GET    /api/v1/public/events/:slug           (public, pas d'auth)
 *
 * Propagation WS via `nexus-event-bus` après chaque mutation.
 */
import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  requireGroupMembership,
  getGroupContext,
} from '../../core/middlewares/require-group-membership.js';
import { findMembership } from '../groups/service.js';
import { publishNexusEvent } from '../../ws/nexus-event-bus.js';

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

import type { FastifyPluginAsync } from 'fastify';

// ─────────────────────────── Mappers ────────────────────────────────────

function toDto(e: EventWithRsvps): EventDto {
  return {
    id: e.id,
    slug: e.slug,
    groupId: e.groupId,
    channelId: e.channelId,
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
        const userId = req.user!.id;
        const created = await createEvent({
          groupId: ctx.groupId,
          channelId: req.body.channelId ?? null,
          tags: req.body.tags ?? [],
          title: req.body.title,
          description: req.body.description ?? null,
          startsAt: new Date(req.body.startsAt),
          location: req.body.location ?? null,
          createdBy: userId,
        });
        await publishNexusEvent({
          type: 'event:created',
          groupId: ctx.groupId,
          timestamp: Date.now(),
          payload: { eventId: created.id },
        });
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
        const filter: { when?: 'upcoming' | 'past' | 'all'; channelId?: string } = {};
        if (req.query.when !== undefined) filter.when = req.query.when;
        if (req.query.channelId !== undefined) filter.channelId = req.query.channelId;
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
        const userId = req.user!.id;
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
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        const patch: Parameters<typeof updateEvent>[1] = {};
        if (req.body.channelId !== undefined) patch.channelId = req.body.channelId;
        if (req.body.tags !== undefined) patch.tags = req.body.tags;
        if (req.body.title !== undefined) patch.title = req.body.title;
        if (req.body.description !== undefined) patch.description = req.body.description;
        if (req.body.startsAt !== undefined) patch.startsAt = new Date(req.body.startsAt);
        if (req.body.location !== undefined) patch.location = req.body.location;
        await updateEvent(req.params.eventId, patch);
        await publishNexusEvent({
          type: 'event:updated',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { eventId: existing.id },
        });
        const full = await getEventById(req.params.eventId);
        if (!full) throw new AppError('INTERNAL_ERROR');
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
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        // Suppression réservée au créateur ou aux admins/owners du groupe.
        const isOwnerOrAdmin =
          membership.role === 'owner' || membership.role === 'admin';
        if (existing.createdBy !== userId && !isOwnerOrAdmin) {
          throw new AppError('PERMISSION_DENIED');
        }
        await deleteEvent(req.params.eventId);
        await publishNexusEvent({
          type: 'event:deleted',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { eventId: existing.id },
        });
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
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        await upsertRsvp(req.params.eventId, userId, req.body.value);
        await publishNexusEvent({
          type: 'event:rsvp',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { eventId: existing.id, userId, value: req.body.value },
        });
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
