/**
 * Schemas Zod Events — DTOs renvoyés au client + bodies acceptés.
 *
 * Source de vérité pour les contrats /api/v1/groups/:groupId/events,
 * /api/v1/events/:eventId, /api/v1/events/:eventId/rsvp, /api/v1/public/events/:slug.
 */
import { z } from 'zod';

export const RsvpValueSchema = z.enum(['yes', 'maybe', 'no']);
export type RsvpValueT = z.infer<typeof RsvpValueSchema>;

// ─────────────────────────── DTOs (replies) ─────────────────────────────

export const EventRsvpDtoSchema = z.object({
  userId: z.string().uuid(),
  value: RsvpValueSchema,
});
export type EventRsvpDto = z.infer<typeof EventRsvpDtoSchema>;

export const EventDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  tags: z.array(z.string()),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  location: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rsvps: z.array(EventRsvpDtoSchema),
});
export type EventDto = z.infer<typeof EventDtoSchema>;

export const EventListReplySchema = z.object({
  events: z.array(EventDtoSchema),
});

export const EventReplySchema = z.object({
  event: EventDtoSchema,
});

// ─────────────────────────── Bodies ─────────────────────────────────────

export const CreateEventBodySchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(4000).nullable().optional(),
  startsAt: z.string().datetime(),
  location: z.string().max(200).nullable().optional(),
});
export type CreateEventBody = z.infer<typeof CreateEventBodySchema>;

export const UpdateEventBodySchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(4000).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  location: z.string().max(200).nullable().optional(),
});
export type UpdateEventBody = z.infer<typeof UpdateEventBodySchema>;

export const RsvpBodySchema = z.object({
  /** `null` annule le RSVP de l'utilisateur (état "non répondu"). */
  value: RsvpValueSchema.nullable(),
});
export type RsvpBody = z.infer<typeof RsvpBodySchema>;

export const DeleteEventReplySchema = z.object({ ok: z.literal(true) });

// ─────────────────────────── Params ─────────────────────────────────────

export const GroupIdParamsSchema = z.object({ groupId: z.string().uuid() });
export const EventIdParamsSchema = z.object({ eventId: z.string().uuid() });
export const SlugParamsSchema = z.object({ slug: z.string().min(4).max(64) });

// ─────────────────────────── Query ──────────────────────────────────────

export const ListEventsQuerySchema = z.object({
  when: z.enum(['upcoming', 'past', 'all']).optional(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;
