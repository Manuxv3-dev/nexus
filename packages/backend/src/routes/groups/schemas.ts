import { z } from 'zod';

/**
 * Schémas Zod pour les endpoints `/api/v1/groups` et `/api/v1/invitations`.
 *
 * Source de vérité côté backend. À redescendre sur le shared package
 * (@nexus/shared) quand on en aura besoin côté front.
 */

// ----- Atomes ----------------------------------------------------------------

export const GroupRoleSchema = z.enum(['owner', 'admin', 'member']);
export type GroupRoleValue = z.infer<typeof GroupRoleSchema>;

export const GroupNameSchema = z.string().min(1).max(80).trim();

// ----- DTOs ------------------------------------------------------------------

export const GroupDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  role: GroupRoleSchema.optional(),
});
export type GroupDtoSchemaType = z.infer<typeof GroupDtoSchema>;

export const GroupMemberDtoSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: GroupRoleSchema,
  joinedAt: z.string().datetime(),
});
export type GroupMemberDtoSchemaType = z.infer<typeof GroupMemberDtoSchema>;

export const GroupInvitationDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  role: GroupRoleSchema,
  maxUses: z.number().int().positive().nullable(),
  usedCount: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type GroupInvitationDtoSchemaType = z.infer<typeof GroupInvitationDtoSchema>;

// ----- Params ----------------------------------------------------------------

export const GroupIdParamsSchema = z.object({
  groupId: z.string().uuid(),
});

export const GroupMemberParamsSchema = z.object({
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const GroupInvitationParamsSchema = z.object({
  groupId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

export const InvitationSlugParamsSchema = z.object({
  slug: z.string().min(4).max(64),
});

// ----- Bodies / replies : groupes -------------------------------------------

export const CreateGroupBodySchema = z.object({
  name: GroupNameSchema,
});

export const CreateGroupReplySchema = z.object({
  group: GroupDtoSchema,
});

export const ListGroupsReplySchema = z.object({
  groups: z.array(GroupDtoSchema),
});

export const GetGroupReplySchema = z.object({
  group: GroupDtoSchema,
});

export const UpdateGroupBodySchema = z.object({
  name: GroupNameSchema.optional(),
});

export const UpdateGroupReplySchema = z.object({
  group: GroupDtoSchema,
});

export const DeleteGroupReplySchema = z.object({
  ok: z.literal(true),
});

// ----- Bodies / replies : membres -------------------------------------------

export const ListMembersReplySchema = z.object({
  members: z.array(GroupMemberDtoSchema),
});

export const RemoveMemberReplySchema = z.object({
  ok: z.literal(true),
});

/**
 * Rôle assignable via `PATCH .../members/:userId/role`. Volontairement plus
 * restreint que `GroupRoleSchema` : le transfert d'ownership est un endpoint
 * séparé (`POST .../transfer-ownership`, MAN-181), donc `'owner'` est rejeté
 * ici en 400 plutôt qu'en 403 — c'est une valeur invalide pour ce endpoint,
 * pas une question d'autorisation.
 */
export const UpdateMemberRoleBodySchema = z.object({
  role: z.enum(['admin', 'member']),
});

export const UpdateMemberRoleReplySchema = z.object({
  member: GroupMemberDtoSchema,
});

/**
 * Transfert d'ownership (MAN-181). Le nouveau owner doit déjà être membre du
 * groupe — pas d'invitation implicite ici, cf. `transferOwnership` (service).
 */
export const TransferOwnershipBodySchema = z.object({
  newOwnerUserId: z.string().uuid(),
});

export const TransferOwnershipReplySchema = z.object({
  ok: z.literal(true),
});

// ----- Bodies / replies : invitations ---------------------------------------

const TTL_MIN = 60 * 1000; // 1 minute
const TTL_MAX = 365 * 24 * 60 * 60 * 1000; // 1 an

export const CreateInvitationBodySchema = z.object({
  role: GroupRoleSchema.optional(),
  maxUses: z.number().int().positive().max(1000).optional(),
  ttlMs: z.number().int().min(TTL_MIN).max(TTL_MAX).optional(),
});

export const CreateInvitationReplySchema = z.object({
  invitation: GroupInvitationDtoSchema,
});

export const ListInvitationsReplySchema = z.object({
  invitations: z.array(GroupInvitationDtoSchema),
});

export const RevokeInvitationReplySchema = z.object({
  ok: z.literal(true),
});

export const AcceptInvitationReplySchema = z.object({
  group: GroupDtoSchema,
});
