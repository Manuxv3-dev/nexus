import { z } from 'zod';

/**
 * DTO Polls partagé backend/web (cf. ticket 0e8b5905).
 *
 * Source de vérité unique pour la forme renvoyée par
 * `packages/backend/src/routes/polls/schemas.ts` (`PollDtoSchema`) et
 * consommée par `@nexus/web` (`packages/web/src/lib/queries.ts`).
 *
 * Les schémas de **body** (create/update/vote) et de **query/params** restent
 * dans `packages/backend/src/routes/polls/schemas.ts`.
 */

export const PollOptionDtoSchema = z.object({
  id: z.string().uuid(),
  pollId: z.string().uuid(),
  label: z.string(),
  position: z.number().int(),
  voters: z.array(z.string().uuid()),
});
export type PollOptionDto = z.infer<typeof PollOptionDtoSchema>;

export const PollDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  tags: z.array(z.string()),
  question: z.string(),
  multi: z.boolean(),
  closesAt: z.string().nullable(),
  options: z.array(PollOptionDtoSchema),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PollDto = z.infer<typeof PollDtoSchema>;
