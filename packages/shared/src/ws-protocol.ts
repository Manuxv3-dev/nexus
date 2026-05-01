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
]);
export type WsEvent = z.infer<typeof WsEventSchema>;

export type PresenceUpdateEvent = z.infer<typeof PresenceUpdateEventSchema>;
export type MessageNewEvent = z.infer<typeof MessageNewEventSchema>;
export type MessageEditEvent = z.infer<typeof MessageEditEventSchema>;
export type MessageDeleteEvent = z.infer<typeof MessageDeleteEventSchema>;
export type MessageReactionEvent = z.infer<typeof MessageReactionEventSchema>;
export type HistorySyncedEvent = z.infer<typeof HistorySyncedEventSchema>;
