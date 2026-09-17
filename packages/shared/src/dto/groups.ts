import { z } from 'zod';

/**
 * DTO Groups partagé backend/web (cf. ticket 0e8b5905).
 *
 * Source de vérité unique pour la forme renvoyée par
 * `packages/backend/src/routes/groups/schemas.ts` (`GroupDtoSchema`,
 * `GroupMemberDtoSchema`) et consommée par `@nexus/web`
 * (`packages/web/src/lib/queries.ts`).
 *
 * `GroupInvitationDtoSchema` (endpoints `/invitations`) n'est **pas** migré
 * ici : hors périmètre du ticket 0e8b5905, à traiter dans un ticket de suite
 * si la dérive constatée sur les DTO events/polls/expenses/todos/groups s'y
 * reproduit. Les schémas de **body** (create/update, validation stricte des
 * entrées) et de **query/params** restent dans
 * `packages/backend/src/routes/groups/schemas.ts`.
 */

export const GroupRoleSchema = z.enum(['owner', 'admin', 'member']);
export type GroupRoleValue = z.infer<typeof GroupRoleSchema>;

export const GroupDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  role: GroupRoleSchema.optional(),
  /**
   * Nombre de membres du groupe. Absent par défaut : présent uniquement si
   * `GET /groups` est appelé avec `withMemberCount=true`. L'optionalité sert
   * à omettre le champ sans le param demandé — pas une question de compat
   * client : un client figé stripperait de toute façon un champ qu'il ne
   * connaît pas.
   */
  memberCount: z.number().int().nonnegative().optional(),
});
export type GroupDto = z.infer<typeof GroupDtoSchema>;

export const GroupMemberDtoSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: GroupRoleSchema,
  joinedAt: z.string().datetime(),
});
export type GroupMemberDto = z.infer<typeof GroupMemberDtoSchema>;
