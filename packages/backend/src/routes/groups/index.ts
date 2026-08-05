import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  getGroupContext,
  requireGroupMembership,
  requireGroupRole,
} from '../../core/middlewares/require-group-membership.js';
import { publishNexusEvent } from '../../ws/nexus-event-bus.js';
import { recordActivityWithLookup } from '../activity/repo.js';

import {
  AcceptInvitationReplySchema,
  CreateGroupBodySchema,
  CreateGroupReplySchema,
  CreateInvitationBodySchema,
  CreateInvitationReplySchema,
  DeleteGroupReplySchema,
  GetGroupReplySchema,
  GroupIdParamsSchema,
  GroupInvitationParamsSchema,
  GroupMemberParamsSchema,
  InvitationSlugParamsSchema,
  ListGroupsReplySchema,
  ListInvitationsReplySchema,
  ListMembersReplySchema,
  RemoveMemberReplySchema,
  RevokeInvitationReplySchema,
  TransferOwnershipBodySchema,
  TransferOwnershipReplySchema,
  UpdateGroupBodySchema,
  UpdateGroupReplySchema,
  UpdateMemberRoleBodySchema,
  UpdateMemberRoleReplySchema,
} from './schemas.js';
import {
  acceptInvitation,
  canManageRole,
  createGroupForUser,
  createInvitation,
  deleteGroup,
  findGroupById,
  findInvitationInGroup,
  findMembership,
  findMemberWithUser,
  groupToDto,
  hasMinRole,
  invitationToDto,
  listGroupsForUser,
  listInvitationsForGroup,
  listMembers,
  memberToDto,
  removeMember,
  revokeInvitation,
  transferOwnership,
  updateGroup,
  updateMemberRole,
} from './service.js';

/**
 * Plugin Fastify regroupant tous les endpoints de gestion des groupes Nexus.
 *
 * Endpoints couverts :
 *   - CRUD groupes : POST/GET/PATCH/DELETE /api/v1/groups[/:id]
 *   - Membres : GET /:groupId/members, DELETE /:groupId/members/:userId,
 *     PATCH /:groupId/members/:userId/role,
 *     POST /:groupId/transfer-ownership
 *   - Invitations : POST/GET /:groupId/invitations, DELETE /:groupId/invitations/:id
 *   - Acceptation publique : POST /api/v1/invitations/:slug/accept
 *
 * Anti-leak : toutes les routes scopées à un groupe passent par
 * `requireGroupMembership`, qui renvoie 404 si l'user n'est pas membre
 * (indistinct de "groupe absent").
 *
 * Contrôle de rôle : `requireGroupRole(req, 'admin' | 'owner')` dans le handler.
 */
export const groupsPlugin: FastifyPluginAsync = async (app) => {
  // ===== CRUD groupes =======================================================

  // ----- POST /api/v1/groups -------------------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups',
      body: CreateGroupBodySchema,
      reply: CreateGroupReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const { group } = await createGroupForUser(userId, { name: req.body.name });
        return { group: groupToDto(group, 'owner') };
      },
    }),
  );

  // ----- GET /api/v1/groups --------------------------------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups',
      reply: ListGroupsReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const rows = await listGroupsForUser(userId);
        return { groups: rows.map(({ group, role }) => groupToDto(group, role)) };
      },
    }),
  );

  // ----- GET /api/v1/groups/:groupId -----------------------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId',
      params: GroupIdParamsSchema,
      reply: GetGroupReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const group = await findGroupById(ctx.groupId);
        if (!group) throw new AppError('RESOURCE_NOT_FOUND');
        return { group: groupToDto(group, ctx.role) };
      },
    }),
  );

  // ----- PATCH /api/v1/groups/:groupId ---------------------------------------
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/groups/:groupId',
      params: GroupIdParamsSchema,
      body: UpdateGroupBodySchema,
      reply: UpdateGroupReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'admin');
        const patch: { name?: string } = {};
        if (req.body.name !== undefined) patch.name = req.body.name;
        const updated = await updateGroup(ctx.groupId, patch);
        return { group: groupToDto(updated, ctx.role) };
      },
    }),
  );

  // ----- DELETE /api/v1/groups/:groupId --------------------------------------
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/groups/:groupId',
      params: GroupIdParamsSchema,
      reply: DeleteGroupReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'owner');
        await deleteGroup(ctx.groupId);
        return { ok: true as const };
      },
    }),
  );

  // ===== Membres =============================================================

  // ----- GET /api/v1/groups/:groupId/members ---------------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/members',
      params: GroupIdParamsSchema,
      reply: ListMembersReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const rows = await listMembers(ctx.groupId);
        return { members: rows.map(({ member, user }) => memberToDto(member, user)) };
      },
    }),
  );

  // ----- DELETE /api/v1/groups/:groupId/members/:userId ----------------------
  // Règles :
  //   - self-leave : tout membre non-owner peut sortir lui-même,
  //     inconditionnellement, quel que soit son rang
  //   - kick : le caller doit gérer un rang strictement supérieur à celui du
  //     target (canManageRole, MAN-182) — un admin peut kicker un member mais
  //     pas un pair admin ni l'owner ; même règle que PATCH .../role, pour
  //     éviter le contournement kick+ré-invitation d'un pair (MAN-185)
  //   - un owner ne peut pas se retirer (transfert d'ownership requis — V2)
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/groups/:groupId/members/:userId',
      params: GroupMemberParamsSchema,
      reply: RemoveMemberReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const callerId = req.user?.id;
        if (!callerId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const targetUserId = req.params.userId;
        const isSelf = targetUserId === callerId;

        // Self-leave possible sauf pour owner
        // Kick : caller doit être admin/owner et target ne doit pas être owner
        const target = await findMembership(ctx.groupId, targetUserId);
        if (!target) throw new AppError('RESOURCE_NOT_FOUND');

        if (target.role === 'owner') {
          throw new AppError('PERMISSION_DENIED', { reason: 'cannot_remove_owner' });
        }

        // Kick : même règle de rang strict que PATCH .../role (canManageRole)
        // — un admin peut kicker un member mais pas un pair admin. Sans ça,
        // un admin pourrait contourner l'impossibilité de rétrograder un
        // pair en le kickant puis en le ré-invitant à un rang inférieur
        // (MAN-182, cf. MAN-185). Le self-leave (isSelf) reste inconditionnel
        // pour un non-owner, quel que soit son rang.
        if (!isSelf && !canManageRole(ctx.role, target.role)) {
          throw new AppError('PERMISSION_DENIED', {
            reason: 'insufficient_rank_to_manage_role',
          });
        }

        await removeMember(ctx.groupId, targetUserId);
        // ADR-029 : log d'activité member:left. L'actor est :
        //   - le user lui-même si self-leave
        //   - le caller (admin/owner) si kick
        // Dans les deux cas le user "qui part" est `targetUserId` et c'est
        // ce qui apparaît dans la timeline. Si on voulait distinguer kick vs
        // leave on créerait un kind dédié — pas en V1.
        await recordActivityWithLookup(
          {
            groupId: ctx.groupId,
            actorId: targetUserId,
            kind: 'member:left',
            targetId: targetUserId,
            targetType: 'member',
            extraPayload: {},
          },
          req.log,
        );
        return { ok: true as const };
      },
    }),
  );

  // ----- PATCH /api/v1/groups/:groupId/members/:userId/role ------------------
  // Règles :
  //   - le caller doit gérer un rang strictement supérieur à celui du target
  //     (canManageRole) — un admin peut gérer un member mais pas un autre
  //     admin ni l'owner ; un member ne gère personne
  //   - 'owner' n'est pas une valeur acceptée ici (rejeté en 400 par Zod) :
  //     le transfert d'ownership est un endpoint séparé (POST
  //     .../transfer-ownership, MAN-181)
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/groups/:groupId/members/:userId/role',
      params: GroupMemberParamsSchema,
      body: UpdateMemberRoleBodySchema,
      reply: UpdateMemberRoleReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const targetUserId = req.params.userId;

        const target = await findMembership(ctx.groupId, targetUserId);
        if (!target) throw new AppError('RESOURCE_NOT_FOUND');

        if (!canManageRole(ctx.role, target.role)) {
          throw new AppError('PERMISSION_DENIED', {
            reason: 'insufficient_rank_to_manage_role',
          });
        }

        // `target.role` est repassé au service : le UPDATE ne matche que si le
        // rôle en base est toujours celui sur lequel `canManageRole` a
        // tranché (409 sinon). Ferme la fenêtre TOCTOU entre la lecture et
        // l'écriture — sans ça un admin pourrait modifier un pair promu
        // entre-temps.
        await updateMemberRole(ctx.groupId, targetUserId, req.body.role, target.role);

        const updated = await findMemberWithUser(ctx.groupId, targetUserId);
        if (!updated) throw new AppError('RESOURCE_NOT_FOUND');

        // Diffuse le changement aux autres clients connectés au groupe
        // (cf. MAN-180) : ils invalident leur query members sans reload.
        // Publié en dernier, une fois la réponse sûre : pas d'event pour une
        // requête qui finirait en erreur.
        await publishNexusEvent({
          type: 'member:role_updated',
          groupId: ctx.groupId,
          timestamp: Date.now(),
          payload: { userId: targetUserId, newRole: req.body.role },
        });
        return { member: memberToDto(updated.member, updated.user) };
      },
    }),
  );

  // ----- POST /api/v1/groups/:groupId/transfer-ownership ---------------------
  // Owner-only (pas de cas admin, contrairement à PATCH .../role) : le
  // transfert d'ownership est l'action la plus sensible du cycle de vie d'un
  // groupe, réservée à celui qui le détient déjà.
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups/:groupId/transfer-ownership',
      params: GroupIdParamsSchema,
      body: TransferOwnershipBodySchema,
      reply: TransferOwnershipReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'owner');
        const callerId = req.user?.id;
        if (!callerId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        await transferOwnership(ctx.groupId, callerId, req.body.newOwnerUserId);

        // Diffuse le transfert aux autres clients connectés au groupe
        // (cf. MAN-181, même pattern que member:role_updated en MAN-180) :
        // publié en dernier, une fois le transfert sûr — pas d'event pour
        // une requête qui finirait en erreur.
        await publishNexusEvent({
          type: 'group:ownership_transferred',
          groupId: ctx.groupId,
          timestamp: Date.now(),
          payload: { previousOwnerUserId: callerId, newOwnerUserId: req.body.newOwnerUserId },
        });
        return { ok: true as const };
      },
    }),
  );

  // ===== Invitations =========================================================

  // ----- POST /api/v1/groups/:groupId/invitations ----------------------------
  // Admin+ requis. Un admin ne peut pas créer d'invitation owner.
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups/:groupId/invitations',
      params: GroupIdParamsSchema,
      body: CreateInvitationBodySchema,
      reply: CreateInvitationReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'admin');
        const callerId = req.user?.id;
        if (!callerId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const requestedRole = req.body.role ?? 'member';
        // On ne peut pas créer d'invitation pour un rôle > son propre rôle
        if (!hasMinRole(ctx.role, requestedRole)) {
          throw new AppError('PERMISSION_DENIED', {
            reason: 'cannot_invite_to_higher_role',
            callerRole: ctx.role,
            requestedRole,
          });
        }

        const invInput: {
          role?: 'owner' | 'admin' | 'member';
          maxUses?: number | null;
          ttlMs?: number;
        } = {
          role: requestedRole,
        };
        if (req.body.maxUses !== undefined) invInput.maxUses = req.body.maxUses;
        if (req.body.ttlMs !== undefined) invInput.ttlMs = req.body.ttlMs;

        const inv = await createInvitation(ctx.groupId, callerId, invInput);
        return { invitation: invitationToDto(inv) };
      },
    }),
  );

  // ----- GET /api/v1/groups/:groupId/invitations -----------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/invitations',
      params: GroupIdParamsSchema,
      reply: ListInvitationsReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'admin');
        const rows = await listInvitationsForGroup(ctx.groupId);
        return { invitations: rows.map(invitationToDto) };
      },
    }),
  );

  // ----- DELETE /api/v1/groups/:groupId/invitations/:invitationId ------------
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/groups/:groupId/invitations/:invitationId',
      params: GroupInvitationParamsSchema,
      reply: RevokeInvitationReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'admin');

        // findInvitationInGroup scope DB-side → anti-leak cross-group natif
        const target = await findInvitationInGroup(ctx.groupId, req.params.invitationId);
        if (!target) throw new AppError('RESOURCE_NOT_FOUND');
        if (target.revokedAt !== null) {
          // Idempotent : déjà révoquée, on renvoie ok
          return { ok: true as const };
        }
        await revokeInvitation(target.id);
        return { ok: true as const };
      },
    }),
  );

  // ----- POST /api/v1/invitations/:slug/accept -------------------------------
  // Endpoint public-membership (auth requise mais pas membership existante,
  // précisément parce qu'on rejoint un groupe).
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/invitations/:slug/accept',
      params: InvitationSlugParamsSchema,
      reply: AcceptInvitationReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const { group } = await acceptInvitation(req.params.slug, userId);
        // Le membership vient d'être créé, role = celui de l'invitation, mais
        // pour faire propre on relit la membership effective :
        const membership = await findMembership(group.id, userId);
        // ADR-029 : log d'activité member:joined.
        await recordActivityWithLookup(
          {
            groupId: group.id,
            actorId: userId,
            kind: 'member:joined',
            targetId: userId,
            targetType: 'member',
            extraPayload: {},
          },
          req.log,
        );
        return { group: groupToDto(group, membership?.role) };
      },
    }),
  );
};
