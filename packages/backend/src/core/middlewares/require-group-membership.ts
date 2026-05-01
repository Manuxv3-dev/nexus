import { findMembership } from '../../routes/groups/service.js';
import { AppError } from '../errors.js';

import type { GroupRole } from '../../db/schema/index.js';
import type { FastifyRequest } from 'fastify';

/**
 * Contexte du groupe attaché à `req.groupContext` après passage par
 * `requireGroupMembership`.
 */
export interface GroupContext {
  groupId: string;
  role: GroupRole;
  membershipId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    groupContext?: GroupContext;
  }
}

/**
 * Pré-handler qui :
 *   1. exige une session authentifiée (`req.user` posé par `requireAuth`)
 *   2. lit `:groupId` dans les params de route
 *   3. vérifie en base que l'utilisateur est membre actif du groupe
 *   4. attache `req.groupContext = { groupId, role, membershipId }`
 *
 * Anti-leak : si l'utilisateur n'est pas membre OU si le groupe n'existe
 * pas, on renvoie 404 `RESOURCE_NOT_FOUND` (pas 403) — ainsi un attaquant
 * ne peut pas énumérer les groupIds valides en distinguant les codes.
 *
 * À utiliser systématiquement en combo avec `requireAuth` :
 *   preHandlers: [requireAuth, requireGroupMembership]
 *
 * Note perf : un read DB est fait à chaque requête. Le JWT contient bien
 * `groupIds`, mais on ne s'y fie pas ici parce que la liste peut être
 * stale (membership révoquée entre émission et usage du token), et que
 * l'on a besoin du rôle, pas juste de l'appartenance. Si ce hit devient
 * un goulot, on caquera via Redis avec invalidation sur write.
 */
export async function requireGroupMembership(req: FastifyRequest): Promise<void> {
  if (!req.user) {
    throw new AppError('AUTH_NOT_AUTHENTICATED');
  }

  const params = req.params as Record<string, unknown> | undefined;
  const groupId = params?.['groupId'];
  if (typeof groupId !== 'string' || groupId.length === 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'missing_group_id_param' });
  }

  const membership = await findMembership(groupId, req.user.id);
  if (!membership) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }

  req.groupContext = {
    groupId,
    role: membership.role,
    membershipId: membership.id,
  };
}

/**
 * Helper : récupère le contexte de groupe attaché à la requête, ou throw
 * `INTERNAL_ERROR` si absent — signifie qu'on a oublié `requireGroupMembership`
 * dans les preHandlers de la route.
 */
export function getGroupContext(req: FastifyRequest): GroupContext {
  if (!req.groupContext) {
    throw new AppError('INTERNAL_ERROR', { reason: 'missing_group_context' });
  }
  return req.groupContext;
}

/**
 * Helper : vérifie que le rôle dans le groupe est au moins `minRole`.
 * Renvoie le contexte (typé non-null) pour usage direct dans le handler.
 *
 * Exemple :
 *   handler: async (req) => {
 *     const ctx = requireGroupRole(req, 'admin');
 *     // ctx.groupId, ctx.role disponibles
 *   }
 */
export function requireGroupRole(req: FastifyRequest, minRole: GroupRole): GroupContext {
  const ctx = getGroupContext(req);
  // Import inline pour éviter une dépendance circulaire au top-level
  // (service.ts → ne dépend pas du middleware ; le middleware → service.ts).
  // hasMinRole est pure, on duplique brièvement la logique pour éviter le cycle.
  const RANK: Record<GroupRole, number> = { owner: 3, admin: 2, member: 1 };
  if (RANK[ctx.role] < RANK[minRole]) {
    throw new AppError('PERMISSION_DENIED', { required: minRole, actual: ctx.role });
  }
  return ctx;
}
