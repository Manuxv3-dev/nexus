/**
 * Schemas Zod pour les routes notifications (cf. ADR-023).
 *
 * Documente la shape attendue du `payload` JSONB par `kind`. Validation
 * stricte côté API : un payload qui ne match pas est rejeté.
 */
import { z } from 'zod';

import { NotificationKindSchema } from '@nexus/shared';

// ─────────────────────────── Payload schemas par kind ────────────────────

/** Rappel d'event programmé (cf. ADR-020 worker). */
export const EventReminderPayloadSchema = z.object({
  eventId: z.string().uuid(),
  eventTitle: z.string(),
  tier: z.enum(['h24', 'h1']),
  startsAt: z.string().datetime(),
});

/** Création d'event où ce user doit RSVP. */
export const EventRsvpRequestedPayloadSchema = z.object({
  eventId: z.string().uuid(),
  eventTitle: z.string(),
  startsAt: z.string().datetime(),
  createdByName: z.string(),
});

/** Dépense ajoutée où ce user a une part à régler. */
export const ExpenseAddedPayloadSchema = z.object({
  expenseId: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
  shareCents: z.number().int().nonnegative(),
  paidByName: z.string(),
});

/** Todo assignée à ce user. */
export const TodoAssignedPayloadSchema = z.object({
  itemId: z.string().uuid(),
  listId: z.string().uuid(),
  text: z.string(),
  listTitle: z.string(),
  assignedByName: z.string(),
});

/**
 * RSVP reçu sur un event créé par ce user (hors scope V1 ADR-023, ajouté au
 * passage car symétrique à `event_rsvp_requested` et utile en pratique :
 * le créateur d'un event aime savoir qui répond).
 */
export const EventRsvpReceivedPayloadSchema = z.object({
  eventId: z.string().uuid(),
  eventTitle: z.string(),
  respondentName: z.string(),
  value: z.enum(['yes', 'no', 'maybe']),
});

/**
 * Todo cochée par quelqu'un d'autre que le créateur de la liste (hors scope
 * V1 ADR-023, ajouté au passage : le créateur veut savoir quand sa liste
 * avance même s'il ne tient pas le crayon).
 */
export const TodoCompletedPayloadSchema = z.object({
  itemId: z.string().uuid(),
  listId: z.string().uuid(),
  text: z.string(),
  listTitle: z.string(),
  completedByName: z.string(),
});

// ─────────────────────────── DTO ─────────────────────────────────────────

export const NotificationDtoSchema = z.object({
  id: z.string().uuid(),
  kind: NotificationKindSchema,
  /** Payload JSONB libre — la shape exacte dépend du kind, cf. schemas
   *  par kind ci-dessus. Côté front on peut narrow-cast via le kind. */
  payload: z.record(z.string(), z.unknown()),
  groupId: z.string().uuid().nullable(),
  sourceId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});

export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

// ─────────────────────────── Query / params ──────────────────────────────

export const ListNotificationsQuerySchema = z.object({
  unread: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  cursor: z.string().datetime().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(1, Math.min(100, Number.parseInt(v, 10))) : undefined)),
});

export const NotificationIdParamsSchema = z.object({
  notificationId: z.string().uuid(),
});

// ─────────────────────────── Replies ─────────────────────────────────────

export const NotificationListReplySchema = z.object({
  notifications: z.array(NotificationDtoSchema),
  unreadCount: z.number().int().nonnegative(),
  nextCursor: z.string().datetime().nullable(),
});

export const MarkReadReplySchema = z.object({
  ok: z.literal(true),
  /** Nombre de notifs marquées comme lues. Pour `mark-one` c'est 0 ou 1,
   *  pour `mark-all` c'est le total réel. */
  markedCount: z.number().int().nonnegative(),
});
