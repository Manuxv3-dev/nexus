import { z } from 'zod';

/**
 * DTO Events partagé backend/web (cf. ticket 0e8b5905).
 *
 * Source de vérité unique pour la forme renvoyée par
 * `packages/backend/src/routes/events/schemas.ts` (`EventDtoSchema`,
 * `eventToDto`) et consommée par `@nexus/web` (`packages/web/src/lib/queries.ts`).
 * Avant cette extraction, le web redéfinissait sa propre copie du DTO : une
 * dérive historique avait été constatée en démo (`slug` / `ownerId` absents
 * du DTO réel), déjà corrigée avant cette PR — le risque de récidive tant
 * qu'il y avait deux définitions à maintenir en synchro reste la raison
 * d'être de cette extraction.
 *
 * Les schémas de **body** (create/update, validation stricte des entrées) et
 * de **query/params** restent dans `packages/backend/src/routes/events/schemas.ts` :
 * ils n'ont pas de raison d'être connus du client.
 */

export const RsvpValueSchema = z.enum(['yes', 'maybe', 'no']);
export type RsvpValue = z.infer<typeof RsvpValueSchema>;

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
