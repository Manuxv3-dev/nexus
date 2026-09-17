/**
 * Schemas Zod Events — DTOs renvoyés au client + bodies acceptés.
 *
 * Source de vérité pour les contrats /api/v1/groups/:groupId/events,
 * /api/v1/events/:eventId, /api/v1/events/:eventId/rsvp, /api/v1/public/events/:slug.
 *
 * Les DTO de réponse (`RsvpValueSchema`, `EventRsvpDtoSchema`,
 * `EventDtoSchema`) vivent dans `@nexus/shared` (cf. ticket 0e8b5905) et sont
 * ré-exportés ici pour ne pas casser les imports internes du package
 * `routes/events/`. Le web les importe directement depuis `@nexus/shared`.
 */
import { EventDtoSchema, EventRsvpDtoSchema, RsvpValueSchema, type RsvpValue } from '@nexus/shared';
import { z } from 'zod';

export { RsvpValueSchema, EventRsvpDtoSchema, EventDtoSchema };
export type { EventRsvpDto, EventDto } from '@nexus/shared';
/** @deprecated Alias historique de `RsvpValue` (cf. `@nexus/shared`). */
export type RsvpValueT = RsvpValue;

// ─────────────────────────── DTOs (replies) ─────────────────────────────

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
