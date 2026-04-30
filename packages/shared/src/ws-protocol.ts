import { z } from 'zod';

/**
 * Protocole WebSocket Nexus (cf. ADR-003).
 *
 * Tous les events échangés sur la connexion `/ws` suivent ce schéma typé.
 * La validation Zod est faite côté backend (à l'émission) et côté client
 * (à la réception, defensive).
 *
 * Format général : { type, payload, timestamp, groupId? }
 */

// ----- Atomes ----------------------------------------------------------------

export const PresenceStatusSchema = z.enum(['online', 'offline']);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

// ----- Events ----------------------------------------------------------------

export const PresenceUpdateEventSchema = z.object({
  type: z.literal('presence:update'),
  payload: z.object({
    userId: z.string().uuid(),
    status: PresenceStatusSchema,
  }),
  groupId: z.string().uuid().optional(),
  timestamp: z.number().int().nonnegative(),
});

/**
 * Discriminated union de tous les events WS supportés.
 *
 * À mesure qu'on ajoute des features (J5+, J6+), on étend cette union.
 * Le helper `WsEventSchema.parse(...)` côté client garantit que toute
 * fuite de format casse au runtime (et au typage si on tient les types
 * à jour côté shared).
 */
export const WsEventSchema = z.discriminatedUnion('type', [PresenceUpdateEventSchema]);
export type WsEvent = z.infer<typeof WsEventSchema>;
export type PresenceUpdateEvent = z.infer<typeof PresenceUpdateEventSchema>;
