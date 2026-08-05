import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors.js';
import { generateSlug } from '../../core/slug-generator.js';
import { getDb } from '../../db/client.js';
import {
  type Group,
  type GroupInvitation,
  type GroupMember,
  type GroupRole,
  type User,
  groupInvitations,
  groupMembers,
  groups,
  users,
} from '../../db/schema/index.js';
import { invalidateGroup } from '../../ws/membership-cache.js';

/**
 * Service métier pour les groupes Nexus.
 *
 * Toute la logique d'autorisation par rôle est ici. Les routes Fastify
 * vérifient l'appartenance via le middleware `requireGroupMembership`,
 * et délèguent l'enforcement de rôle (admin/owner) à ce service.
 */

// ----- Hiérarchie des rôles --------------------------------------------------

const ROLE_RANK: Record<GroupRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export function hasMinRole(userRole: GroupRole, minRole: GroupRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}

/**
 * Détermine si `callerRole` peut gérer (changer le rôle de, ou retirer) un
 * membre ayant `targetRole`.
 *
 * Contrairement à `hasMinRole` (comparaison `>=`), la gestion d'un membre
 * exige un rang **strictement supérieur** : un owner ne peut pas se gérer
 * lui-même, et deux rôles de même rang ne peuvent pas se gérer entre eux.
 */
export function canManageRole(callerRole: GroupRole, targetRole: GroupRole): boolean {
  return ROLE_RANK[callerRole] > ROLE_RANK[targetRole];
}

// ----- DTOs ------------------------------------------------------------------

export interface GroupDto {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Rôle de l'utilisateur courant dans ce groupe (présent si listé via /groups). */
  role?: GroupRole;
}

export interface GroupMemberDto {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: GroupRole;
  joinedAt: string;
}

export interface GroupInvitationDto {
  id: string;
  slug: string;
  groupId: string;
  role: GroupRole;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export function groupToDto(g: Group, role?: GroupRole): GroupDto {
  const dto: GroupDto = {
    id: g.id,
    name: g.name,
    createdBy: g.createdBy,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
  if (role) dto.role = role;
  return dto;
}

export function memberToDto(m: GroupMember, u: User): GroupMemberDto {
  return {
    userId: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
  };
}

export function invitationToDto(i: GroupInvitation): GroupInvitationDto {
  return {
    id: i.id,
    slug: i.slug,
    groupId: i.groupId,
    role: i.role,
    maxUses: i.maxUses,
    usedCount: i.usedCount,
    expiresAt: i.expiresAt.toISOString(),
    revokedAt: i.revokedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

// ----- Création --------------------------------------------------------------

export async function createGroupForUser(
  userId: string,
  input: { name: string },
): Promise<{ group: Group; membership: GroupMember }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [group] = await tx
      .insert(groups)
      .values({ name: input.name, createdBy: userId })
      .returning();
    if (!group) throw new AppError('INTERNAL_ERROR');

    const [membership] = await tx
      .insert(groupMembers)
      .values({ groupId: group.id, userId, role: 'owner' })
      .returning();
    if (!membership) throw new AppError('INTERNAL_ERROR');

    return { group, membership };
  });
}

// ----- Lecture ---------------------------------------------------------------

export async function listGroupsForUser(
  userId: string,
): Promise<{ group: Group; role: GroupRole }[]> {
  const db = getDb();
  const rows = await db
    .select({
      group: groups,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(desc(groups.updatedAt));
  return rows;
}

export async function findGroupById(groupId: string): Promise<Group | undefined> {
  const db = getDb();
  const rows = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  return rows[0];
}

export async function findMembership(
  groupId: string,
  userId: string,
): Promise<GroupMember | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function listMembers(groupId: string): Promise<{ member: GroupMember; user: User }[]> {
  const db = getDb();
  const rows = await db
    .select({ member: groupMembers, user: users })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(desc(groupMembers.joinedAt));
  return rows;
}

// ----- Mise à jour / suppression --------------------------------------------

export async function updateGroup(groupId: string, patch: { name?: string }): Promise<Group> {
  const db = getDb();
  const [updated] = await db
    .update(groups)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(groups.id, groupId))
    .returning();
  if (!updated) throw new AppError('RESOURCE_NOT_FOUND');
  return updated;
}

export async function deleteGroup(groupId: string): Promise<void> {
  const db = getDb();
  const result = await db.delete(groups).where(eq(groups.id, groupId)).returning({ id: groups.id });
  if (result.length === 0) throw new AppError('RESOURCE_NOT_FOUND');
}

export async function removeMember(groupId: string, userId: string): Promise<void> {
  const db = getDb();
  const result = await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .returning({ id: groupMembers.id });
  if (result.length === 0) throw new AppError('RESOURCE_NOT_FOUND');
  // Sans ça, le relay WS (`getGroupMembers`, cache 5 min) continuerait à
  // broadcaster à ce user jusqu'à expiration du cache (cf. MAN-17).
  invalidateGroup(groupId);
}

// ----- Invitations -----------------------------------------------------------

const DEFAULT_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 j
const MAX_INVITATION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 an

export async function createInvitation(
  groupId: string,
  createdBy: string,
  input: {
    role?: GroupRole;
    maxUses?: number | null;
    ttlMs?: number;
  },
): Promise<GroupInvitation> {
  const db = getDb();
  const ttl = Math.min(input.ttlMs ?? DEFAULT_INVITATION_TTL_MS, MAX_INVITATION_TTL_MS);
  const expiresAt = new Date(Date.now() + ttl);

  // Génération avec retry si collision (très improbable)
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug(12);
    try {
      const [created] = await db
        .insert(groupInvitations)
        .values({
          groupId,
          slug,
          createdBy,
          role: input.role ?? 'member',
          maxUses: input.maxUses ?? null,
          expiresAt,
        })
        .returning();
      if (!created) throw new AppError('INTERNAL_ERROR');
      return created;
    } catch (err) {
      // Retry sur collision unique slug, autres erreurs → bubble up
      const msg = err instanceof Error ? err.message : '';
      if (!/group_invitations_slug_idx|unique/i.test(msg)) throw err;
    }
  }
  throw new AppError('INTERNAL_ERROR', { reason: 'slug_collision_after_retries' });
}

export async function findInvitationBySlug(slug: string): Promise<GroupInvitation | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(groupInvitations)
    .where(eq(groupInvitations.slug, slug))
    .limit(1);
  return rows[0];
}

/**
 * Cherche une invitation par id ET groupe — scoping anti-leak.
 *
 * On ne fournit volontairement pas de `findInvitationById` simple : un
 * caller qui veut lire une invitation doit toujours valider qu'elle
 * appartient au groupe scope, sinon un user pourrait découvrir/manipuler
 * des invitations d'autres groupes.
 */
export async function findInvitationInGroup(
  groupId: string,
  invitationId: string,
): Promise<GroupInvitation | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(groupInvitations)
    .where(and(eq(groupInvitations.id, invitationId), eq(groupInvitations.groupId, groupId)))
    .limit(1);
  return rows[0];
}

export async function listInvitationsForGroup(groupId: string): Promise<GroupInvitation[]> {
  const db = getDb();
  return db
    .select()
    .from(groupInvitations)
    .where(eq(groupInvitations.groupId, groupId))
    .orderBy(desc(groupInvitations.createdAt));
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(groupInvitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(groupInvitations.id, invitationId), isNull(groupInvitations.revokedAt)));
}

/**
 * Tente d'utiliser une invitation. Renvoie le membership créé (ou existant
 * si l'utilisateur était déjà membre).
 *
 * Atomicité : transaction qui :
 *   1. lock la ligne invitation (FOR UPDATE)
 *   2. vérifie validité (revoked, expired, maxUses)
 *   3. incrémente usedCount
 *   4. crée la membership (idempotent : si déjà membre, no-op)
 */
export async function acceptInvitation(
  slug: string,
  userId: string,
): Promise<{ membership: GroupMember; group: Group }> {
  const db = getDb();
  let joinedGroupId: string | undefined;

  const result = await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(groupInvitations)
      .where(eq(groupInvitations.slug, slug))
      .for('update')
      .limit(1);

    if (!inv) throw new AppError('RESOURCE_NOT_FOUND');
    if (inv.revokedAt !== null) throw new AppError('AUTH_REFRESH_REVOKED');
    if (inv.expiresAt.getTime() < Date.now()) throw new AppError('AUTH_TOKEN_EXPIRED');
    if (inv.maxUses !== null && inv.usedCount >= inv.maxUses) {
      throw new AppError('RESOURCE_CONFLICT', { reason: 'invitation_max_uses_reached' });
    }

    const [group] = await tx.select().from(groups).where(eq(groups.id, inv.groupId)).limit(1);
    if (!group) throw new AppError('RESOURCE_NOT_FOUND');

    // Idempotent : si déjà membre, on retourne l'existant
    const existing = await tx
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, inv.groupId), eq(groupMembers.userId, userId)))
      .limit(1);

    if (existing[0]) {
      return { membership: existing[0], group };
    }

    const [membership] = await tx
      .insert(groupMembers)
      .values({ groupId: inv.groupId, userId, role: inv.role })
      .returning();
    if (!membership) throw new AppError('INTERNAL_ERROR');

    await tx
      .update(groupInvitations)
      .set({ usedCount: sql`${groupInvitations.usedCount} + 1` })
      .where(eq(groupInvitations.id, inv.id));

    joinedGroupId = inv.groupId;
    return { membership, group };
  });

  // Hors transaction et APRÈS commit : invalider avant que la ligne soit
  // visible ré-ouvrirait la fenêtre qu'on cherche à fermer (un
  // `getGroupMembers()` concurrent lirait un état pas encore commité et
  // re-cacherait la liste sans le nouveau membre pour 5 min). Sans ça, le
  // nouveau membre rate les broadcasts WS du groupe (cache `getGroupMembers`
  // du relay, cf. MAN-17).
  if (joinedGroupId) {
    invalidateGroup(joinedGroupId);
  }

  return result;
}
