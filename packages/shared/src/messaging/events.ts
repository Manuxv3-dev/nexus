import { z } from 'zod';

import { ProviderMessageSchema, ProviderStatusSchema, ProviderTypeSchema } from './provider.js';

/**
 * Events normalisés émis par les workers bridges et propagés via Redis
 * pub/sub vers le backend HTTP (qui les relaie ensuite sur le WebSocket
 * vers les clients).
 *
 * Cf. ADR-009. Le module `@nexus/backend/integrations/core/event-bus.ts`
 * publie sur `bridge:event:<providerType>` et le backend HTTP est abonné.
 */

// ----- Common envelope -------------------------------------------------------

const BaseBridgeEventSchema = z.object({
  /** Identifie la session messagerie source (UUID Nexus, pas l'externalId). */
  sessionId: z.string().uuid(),
  /** Type de provider — utile pour debug et routing. */
  providerType: ProviderTypeSchema,
  /** Timestamp de l'event (ms epoch, fourni par le worker). */
  timestamp: z.number().int().nonnegative(),
});

// ----- Message events --------------------------------------------------------

export const BridgeMessageNewEventSchema = BaseBridgeEventSchema.extend({
  kind: z.literal('message:new'),
  message: ProviderMessageSchema,
});
export type BridgeMessageNewEvent = z.infer<typeof BridgeMessageNewEventSchema>;

export const BridgeMessageEditEventSchema = BaseBridgeEventSchema.extend({
  kind: z.literal('message:edit'),
  message: ProviderMessageSchema,
});
export type BridgeMessageEditEvent = z.infer<typeof BridgeMessageEditEventSchema>;

export const BridgeMessageDeleteEventSchema = BaseBridgeEventSchema.extend({
  kind: z.literal('message:delete'),
  channelExternalId: z.string(),
  externalMessageId: z.string(),
});
export type BridgeMessageDeleteEvent = z.infer<typeof BridgeMessageDeleteEventSchema>;

export const BridgeReactionEventSchema = BaseBridgeEventSchema.extend({
  kind: z.literal('message:reaction'),
  channelExternalId: z.string(),
  externalMessageId: z.string(),
  emoji: z.string(),
  byExternalUserId: z.string(),
  added: z.boolean(), // true = ajouté, false = retiré
});
export type BridgeReactionEvent = z.infer<typeof BridgeReactionEventSchema>;

// ----- Channel / lifecycle events --------------------------------------------

export const BridgeChannelUpsertEventSchema = BaseBridgeEventSchema.extend({
  kind: z.literal('channel:upsert'),
  externalId: z.string(),
  name: z.string(),
  channelType: z.enum(['text', 'dm', 'group_dm']),
});
export type BridgeChannelUpsertEvent = z.infer<typeof BridgeChannelUpsertEventSchema>;

export const BridgeStatusEventSchema = BaseBridgeEventSchema.extend({
  kind: z.literal('status:update'),
  status: ProviderStatusSchema,
});
export type BridgeStatusEvent = z.infer<typeof BridgeStatusEventSchema>;

export const BridgeHistorySyncedEventSchema = BaseBridgeEventSchema.extend({
  kind: z.literal('history:synced'),
  channelExternalId: z.string(),
  count: z.number().int().nonnegative(),
});
export type BridgeHistorySyncedEvent = z.infer<typeof BridgeHistorySyncedEventSchema>;

// ----- Discriminated union ---------------------------------------------------

export const BridgeEventSchema = z.discriminatedUnion('kind', [
  BridgeMessageNewEventSchema,
  BridgeMessageEditEventSchema,
  BridgeMessageDeleteEventSchema,
  BridgeReactionEventSchema,
  BridgeChannelUpsertEventSchema,
  BridgeStatusEventSchema,
  BridgeHistorySyncedEventSchema,
]);
export type BridgeEvent = z.infer<typeof BridgeEventSchema>;

// ----- Control commands (API HTTP → worker) ----------------------------------

export const BridgeControlSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session:added'),
    sessionId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('session:removed'),
    sessionId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('session:reconnect'),
    sessionId: z.string().uuid(),
  }),
]);
export type BridgeControl = z.infer<typeof BridgeControlSchema>;

/**
 * Helpers de nommage des topics Redis pub/sub. Les workers s'abonnent à
 * leur propre topic de contrôle, le backend HTTP s'abonne à tous les
 * topics d'events.
 */
export function eventTopic(providerType: 'discord' | 'whatsapp' | 'messenger'): string {
  return `bridge:event:${providerType}`;
}
export function controlTopic(providerType: 'discord' | 'whatsapp' | 'messenger'): string {
  return `bridge:control:${providerType}`;
}
