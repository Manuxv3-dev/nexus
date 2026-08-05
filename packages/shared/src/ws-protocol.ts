import { z } from 'zod';

import { ProviderMessageSchema, ProviderTypeSchema } from './messaging/provider.js';

/**
 * Protocole WebSocket Nexus (cf. ADR-003).
 *
 * Tous les events échangés sur la connexion `/ws` suivent ce schéma typé.
 * La validation Zod est faite côté backend (à l'émission) et côté client
 * (à la réception, defensive).
 *
 * Format général : { type, payload, groupId?, timestamp }
 */

// ----- Atomes ----------------------------------------------------------------

export const PresenceStatusSchema = z.enum(['online', 'offline']);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

// ----- presence:update -------------------------------------------------------

export const PresenceUpdateEventSchema = z.object({
  type: z.literal('presence:update'),
  payload: z.object({
    userId: z.string().uuid(),
    status: PresenceStatusSchema,
  }),
  groupId: z.string().uuid().optional(),
  timestamp: z.number().int().nonnegative(),
});

// ----- message:* (J3c — bridges messageries) ---------------------------------

/**
 * Champs communs aux events de message :
 *  - `groupId` : groupe Nexus scope (le client filtre sur ça)
 *  - `sessionId` : session messagerie source (debug + futur multi-session par groupe)
 *  - `providerType` : 'discord' | 'whatsapp' | 'messenger'
 *  - `channelExternalId` : id du channel côté provider externe
 */
const MessageEventBaseSchema = z.object({
  groupId: z.string().uuid(),
  sessionId: z.string().uuid(),
  providerType: ProviderTypeSchema,
  channelExternalId: z.string(),
  timestamp: z.number().int().nonnegative(),
});

export const MessageNewEventSchema = MessageEventBaseSchema.extend({
  type: z.literal('message:new'),
  payload: z.object({ message: ProviderMessageSchema }),
});

export const MessageEditEventSchema = MessageEventBaseSchema.extend({
  type: z.literal('message:edit'),
  payload: z.object({ message: ProviderMessageSchema }),
});

export const MessageDeleteEventSchema = MessageEventBaseSchema.extend({
  type: z.literal('message:delete'),
  payload: z.object({ externalMessageId: z.string() }),
});

export const MessageReactionEventSchema = MessageEventBaseSchema.extend({
  type: z.literal('message:reaction'),
  payload: z.object({
    externalMessageId: z.string(),
    emoji: z.string(),
    byExternalUserId: z.string(),
    added: z.boolean(),
  }),
});

export const HistorySyncedEventSchema = MessageEventBaseSchema.extend({
  type: z.literal('history:synced'),
  payload: z.object({ count: z.number().int().nonnegative() }),
});

// ----- Killer features (J5b #37) ---------------------------------------------
//
// Tous les events killer features sont scopés par `groupId` (le client
// filtre sur le groupe actif pour décider d'invalider sa query). On garde
// le payload minimal : seulement l'id de la ressource impactée. Le client
// déclenche un refetch ciblé pour récupérer le DTO à jour.

const KillerEventBaseSchema = z.object({
  groupId: z.string().uuid(),
  timestamp: z.number().int().nonnegative(),
});

const RsvpValueSchema = z.enum(['yes', 'maybe', 'no']);

// ----- Events ----------------------------------------------------------------

export const EventCreatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('event:created'),
  payload: z.object({ eventId: z.string().uuid() }),
});
export const EventUpdatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('event:updated'),
  payload: z.object({ eventId: z.string().uuid() }),
});
export const EventDeletedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('event:deleted'),
  payload: z.object({ eventId: z.string().uuid() }),
});
export const EventRsvpEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('event:rsvp'),
  payload: z.object({
    eventId: z.string().uuid(),
    userId: z.string().uuid(),
    value: RsvpValueSchema.nullable(),
  }),
});

/**
 * Rappel d'event programmé (cf. ADR-020, J5b #42).
 *
 * Émis par le worker `event-reminders` (BullMQ) à T-24h et T-1h du début
 * de l'event. Le worker calcule l'audience (members du group sauf
 * RSVP=`no`) et la passe dans `userIds`. Le client filtre sur son propre
 * userId pour décider d'afficher la toast.
 *
 * Note V1 : on expose `userIds` en clair plutôt que de router per-user via
 * la couche WS — moins de fan-out réseau, légère fuite côté client (les
 * members se voient déjà entre eux). À reconsidérer si besoin de
 * confidentialité stricte (cf. backlog dette V2).
 */
export const EventReminderTierSchema = z.enum(['h24', 'h1']);
export type EventReminderTier = z.infer<typeof EventReminderTierSchema>;

export const EventReminderEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('event:reminder'),
  payload: z.object({
    eventId: z.string().uuid(),
    tier: EventReminderTierSchema,
    userIds: z.array(z.string().uuid()),
  }),
});

// ----- Polls -----------------------------------------------------------------

export const PollCreatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('poll:created'),
  payload: z.object({ pollId: z.string().uuid() }),
});
export const PollUpdatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('poll:updated'),
  payload: z.object({ pollId: z.string().uuid() }),
});
export const PollDeletedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('poll:deleted'),
  payload: z.object({ pollId: z.string().uuid() }),
});
export const PollVotedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('poll:voted'),
  payload: z.object({
    pollId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
});

// ----- Expenses --------------------------------------------------------------

export const ExpenseAddedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('expense:added'),
  payload: z.object({ expenseId: z.string().uuid() }),
});
export const ExpenseUpdatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('expense:updated'),
  payload: z.object({ expenseId: z.string().uuid() }),
});
export const ExpenseDeletedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('expense:deleted'),
  payload: z.object({ expenseId: z.string().uuid() }),
});
export const ExpenseSettledEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('expense:settled'),
  payload: z.object({
    expenseId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
});

// ----- Todos -----------------------------------------------------------------

export const TodoListCreatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('todo_list:created'),
  payload: z.object({ listId: z.string().uuid() }),
});
export const TodoListUpdatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('todo_list:updated'),
  payload: z.object({ listId: z.string().uuid() }),
});
export const TodoListDeletedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('todo_list:deleted'),
  payload: z.object({ listId: z.string().uuid() }),
});
export const TodoItemAddedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('todo_item:added'),
  payload: z.object({
    listId: z.string().uuid(),
    itemId: z.string().uuid(),
  }),
});
export const TodoItemUpdatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('todo_item:updated'),
  payload: z.object({
    listId: z.string().uuid(),
    itemId: z.string().uuid(),
  }),
});
export const TodoItemCheckedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('todo_item:checked'),
  payload: z.object({
    listId: z.string().uuid(),
    itemId: z.string().uuid(),
    done: z.boolean(),
  }),
});
export const TodoItemDeletedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('todo_item:deleted'),
  payload: z.object({
    listId: z.string().uuid(),
    itemId: z.string().uuid(),
  }),
});

// ----- Membres (gestion de groupe, cf. MAN-168/MAN-180) ----------------------

/**
 * Rôles assignables via `PATCH /groups/:groupId/members/:userId/role`.
 *
 * Volontairement plus restreint que le rôle complet d'un membre
 * (`owner | admin | member`) : `owner` n'est jamais une valeur cible de cet
 * endpoint, le transfert d'ownership étant un flux séparé (phase
 * ultérieure). Garder ce sous-ensemble ici (plutôt que d'importer le schema
 * complet du backend) évite un couplage shared → backend pour un enum aussi
 * simple.
 */
export const AssignableMemberRoleSchema = z.enum(['admin', 'member']);
export type AssignableMemberRole = z.infer<typeof AssignableMemberRoleSchema>;

export const MemberRoleUpdatedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('member:role_updated'),
  payload: z.object({
    userId: z.string().uuid(),
    newRole: AssignableMemberRoleSchema,
  }),
});

/**
 * Diffusé par `POST /groups/:groupId/transfer-ownership` (cf. MAN-181) une
 * fois le transfert persisté avec succès.
 *
 * Un seul event portant les deux userId concernés plutôt que deux events
 * séparés (un par membre dont le rôle change) : le client doit mettre à jour
 * deux lignes de façon atomique dans son cache, et deux events indépendants
 * pourraient arriver dans le désordre côté transport.
 */
export const OwnershipTransferredEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('group:ownership_transferred'),
  payload: z.object({
    previousOwnerUserId: z.string().uuid(),
    newOwnerUserId: z.string().uuid(),
  }),
});

/**
 * Diffusé par `DELETE /groups/:groupId/members/:userId` (cf. MAN-182 Task 3)
 * une fois le retrait persisté avec succès — kick **et** self-leave (les deux
 * voies passent par le même service `removeMember`).
 *
 * Distinct de la notification `member_removed` (ADR-023) : cette dernière ne
 * cible que la personne retirée (jamais pour un self-leave), alors que cet
 * event WS cible les *autres* membres du groupe pour qu'ils mettent à jour
 * leur liste de membres sans reload — y compris sur un départ volontaire.
 */
export const MemberRemovedEventSchema = KillerEventBaseSchema.extend({
  type: z.literal('member:removed'),
  payload: z.object({
    userId: z.string().uuid(),
  }),
});

// ----- Notifications transverses (cf. ADR-023, J5b V1.2) ---------------------

/**
 * Émis par les producteurs (worker event-reminders, routes mutations) chaque
 * fois qu'une notif est insérée en DB pour un user. Le client filtre sur son
 * userId (même pattern que `event:reminder`) puis refetch sa query
 * `['notifications']`.
 *
 * Note V1 : on expose `userId` en clair dans le payload — légère fuite côté
 * client (les autres members du group voient qu'untel a une notif sans en
 * connaître le contenu). Acceptable, dette V2 si besoin per-user strict.
 */
export const NotificationKindSchema = z.enum([
  'event_reminder',
  'event_rsvp_requested',
  'event_rsvp_received',
  'expense_added',
  'todo_assigned',
  'todo_completed',
  'member_removed',
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationCreatedEventSchema = z.object({
  type: z.literal('notification:created'),
  groupId: z.string().uuid().nullable(),
  timestamp: z.number().int().nonnegative(),
  payload: z.object({
    notificationId: z.string().uuid(),
    userId: z.string().uuid(),
    kind: NotificationKindSchema,
  }),
});

// ----- Discriminated union ---------------------------------------------------

/**
 * Discriminated union de tous les events WS supportés.
 *
 * À mesure qu'on ajoute des features (J5+, J6+), on étend cette union.
 * Le helper `WsEventSchema.parse(...)` côté client garantit que toute
 * fuite de format casse au runtime (et au typage si on tient les types
 * à jour côté shared).
 */
export const WsEventSchema = z.discriminatedUnion('type', [
  PresenceUpdateEventSchema,
  MessageNewEventSchema,
  MessageEditEventSchema,
  MessageDeleteEventSchema,
  MessageReactionEventSchema,
  HistorySyncedEventSchema,
  // Killer features
  EventCreatedEventSchema,
  EventUpdatedEventSchema,
  EventDeletedEventSchema,
  EventRsvpEventSchema,
  EventReminderEventSchema,
  PollCreatedEventSchema,
  PollUpdatedEventSchema,
  PollDeletedEventSchema,
  PollVotedEventSchema,
  ExpenseAddedEventSchema,
  ExpenseUpdatedEventSchema,
  ExpenseDeletedEventSchema,
  ExpenseSettledEventSchema,
  TodoListCreatedEventSchema,
  TodoListUpdatedEventSchema,
  TodoListDeletedEventSchema,
  TodoItemAddedEventSchema,
  TodoItemUpdatedEventSchema,
  TodoItemCheckedEventSchema,
  TodoItemDeletedEventSchema,
  MemberRoleUpdatedEventSchema,
  OwnershipTransferredEventSchema,
  MemberRemovedEventSchema,
  NotificationCreatedEventSchema,
]);
export type WsEvent = z.infer<typeof WsEventSchema>;

export type PresenceUpdateEvent = z.infer<typeof PresenceUpdateEventSchema>;
export type MessageNewEvent = z.infer<typeof MessageNewEventSchema>;
export type MessageEditEvent = z.infer<typeof MessageEditEventSchema>;
export type MessageDeleteEvent = z.infer<typeof MessageDeleteEventSchema>;
export type MessageReactionEvent = z.infer<typeof MessageReactionEventSchema>;
export type HistorySyncedEvent = z.infer<typeof HistorySyncedEventSchema>;
export type EventCreatedEvent = z.infer<typeof EventCreatedEventSchema>;
export type EventUpdatedEvent = z.infer<typeof EventUpdatedEventSchema>;
export type EventDeletedEvent = z.infer<typeof EventDeletedEventSchema>;
export type EventRsvpEvent = z.infer<typeof EventRsvpEventSchema>;
export type EventReminderEvent = z.infer<typeof EventReminderEventSchema>;
export type NotificationCreatedEvent = z.infer<typeof NotificationCreatedEventSchema>;
export type PollCreatedEvent = z.infer<typeof PollCreatedEventSchema>;
export type PollVotedEvent = z.infer<typeof PollVotedEventSchema>;
export type ExpenseAddedEvent = z.infer<typeof ExpenseAddedEventSchema>;
export type ExpenseSettledEvent = z.infer<typeof ExpenseSettledEventSchema>;
export type TodoListCreatedEvent = z.infer<typeof TodoListCreatedEventSchema>;
export type TodoItemAddedEvent = z.infer<typeof TodoItemAddedEventSchema>;
export type TodoItemCheckedEvent = z.infer<typeof TodoItemCheckedEventSchema>;
export type MemberRoleUpdatedEvent = z.infer<typeof MemberRoleUpdatedEventSchema>;
export type OwnershipTransferredEvent = z.infer<typeof OwnershipTransferredEventSchema>;
export type MemberRemovedEvent = z.infer<typeof MemberRemovedEventSchema>;
