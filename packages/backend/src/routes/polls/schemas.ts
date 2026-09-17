/**
 * Schemas Zod Polls — DTOs renvoyés au client + bodies acceptés.
 *
 * Les DTO de réponse (`PollOptionDtoSchema`, `PollDtoSchema`) vivent dans
 * `@nexus/shared` (cf. ticket 0e8b5905) et sont ré-exportés ici pour ne pas
 * casser les imports internes du package `routes/polls/`. Le web les
 * importe directement depuis `@nexus/shared`.
 */
import { PollDtoSchema, PollOptionDtoSchema } from '@nexus/shared';
import { z } from 'zod';

export { PollOptionDtoSchema, PollDtoSchema };
export type { PollOptionDto, PollDto } from '@nexus/shared';

// ─────────────────────────── DTOs (replies) ─────────────────────────────

export const PollListReplySchema = z.object({ polls: z.array(PollDtoSchema) });
export const PollReplySchema = z.object({ poll: PollDtoSchema });
export const DeletePollReplySchema = z.object({ ok: z.literal(true) });

// ─────────────────────────── Bodies ─────────────────────────────────────

export const CreatePollBodySchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  question: z.string().min(1).max(280).trim(),
  multi: z.boolean().optional(),
  closesAt: z.string().datetime().nullable().optional(),
  options: z.array(z.string().min(1).max(120).trim()).min(2).max(10),
});

export const UpdatePollBodySchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  question: z.string().min(1).max(280).trim().optional(),
  multi: z.boolean().optional(),
  closesAt: z.string().datetime().nullable().optional(),
});

export const VoteBodySchema = z.object({
  optionId: z.string().uuid(),
  /** true = je vote pour cette option, false = je retire mon vote. */
  value: z.boolean(),
});

// ─────────────────────────── Params / Query ─────────────────────────────

export const GroupIdParamsSchema = z.object({ groupId: z.string().uuid() });
export const PollIdParamsSchema = z.object({ pollId: z.string().uuid() });
export const SlugParamsSchema = z.object({ slug: z.string().min(4).max(64) });

export const ListPollsQuerySchema = z.object({
  state: z.enum(['open', 'closed', 'all']).optional(),
});
