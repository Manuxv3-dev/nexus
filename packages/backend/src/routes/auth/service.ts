import { createHash, randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

import { CSRF_COOKIE } from '../../core/csrf.js';
import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';
import { getDb } from '../../db/client.js';
import {
  events,
  expenses,
  groupMembers,
  groups,
  messagingProviderSessions,
  polls,
  refreshTokens,
  todoLists,
  users,
  type GroupRole,
  type User,
} from '../../db/schema/index.js';
import { invalidateGroup } from '../../ws/membership-cache.js';

import type { LandingPreference, UserDto } from './schemas.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

interface AccessTokenPayload {
  sub: string;
  groupIds: string[];
  type: 'access';
}

export function signAccessToken(userId: string, groupIds: string[]): string {
  const env = loadEnv();
  const payload: AccessTokenPayload = { sub: userId, groupIds, type: 'access' };
  const options: jwt.SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL as unknown as number,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const env = loadEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) {
      throw new AppError('AUTH_TOKEN_INVALID');
    }
    const payload = decoded as Partial<AccessTokenPayload>;
    if (
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      !Array.isArray(payload.groupIds)
    ) {
      throw new AppError('AUTH_TOKEN_INVALID');
    }
    return { sub: payload.sub, groupIds: payload.groupIds, type: 'access' };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) throw new AppError('AUTH_TOKEN_EXPIRED');
    throw new AppError('AUTH_TOKEN_INVALID', null, { cause: err });
  }
}

/**
 * Hash SHA-256 hex commun aux jetons opaques (refresh token, reset password
 * token) — seul le hash est persisté en DB, jamais la valeur brute. Factorisé
 * ici car les deux usages partagent le même besoin (opaque, non-JWT,
 * vérifiable par comparaison de hash) ; si l'un des deux devait un jour
 * changer d'algo indépendamment, on le sortira dans sa propre fonction.
 */
function hashOpaqueToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateRefreshToken(): string {
  return randomUUID();
}

export function hashRefreshToken(raw: string): string {
  return hashOpaqueToken(raw);
}

export function generateResetToken(): string {
  return randomUUID();
}

export function hashResetToken(raw: string): string {
  return hashOpaqueToken(raw);
}

export function parseTtlMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid TTL format: ${ttl}`);
  }
  const n = Number.parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const mult = multipliers[unit];
  if (!mult) throw new Error(`Invalid TTL unit: ${unit}`);
  return n * mult;
}

interface IssueRefreshOpts {
  userId: string;
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function issueRefreshToken(
  opts: IssueRefreshOpts,
): Promise<{ raw: string; id: string }> {
  const env = loadEnv();
  const raw = generateRefreshToken();
  const tokenHash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + parseTtlMs(env.JWT_REFRESH_TTL));

  const db = getDb();
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId: opts.userId,
      tokenHash,
      deviceId: opts.deviceId ?? null,
      userAgent: opts.userAgent ?? null,
      ipAddress: opts.ipAddress ?? null,
      expiresAt,
    })
    .returning({ id: refreshTokens.id });

  if (!row) throw new AppError('INTERNAL_ERROR');
  return { raw, id: row.id };
}

/** Valeurs valides côté Zod (cf. schemas.ts LandingPreferenceSchema). */
const LANDING_PREFERENCE_VALUES: ReadonlySet<LandingPreference> = new Set([
  'home',
  'last_channel',
  'last_group_first_channel',
  'last_group_first_feature',
]);

function coerceLandingPreference(raw: string | null | undefined): LandingPreference {
  // landing_preference est NOT NULL en DB avec défaut 'home', mais on reste
  // defensive : si un audit / dump réintroduit une valeur inconnue, on
  // retombe sur 'home' plutôt que de planter la route /me.
  if (raw && (LANDING_PREFERENCE_VALUES as ReadonlySet<string>).has(raw)) {
    return raw as LandingPreference;
  }
  return 'home';
}

export function userToDto(u: User): UserDto {
  // theme_preference est text en DB ; on cast en enum si valide, sinon null
  // (defensive : un audit accidentel ne plante pas la route).
  const tp = u.themePreference;
  const themePreference = tp === 'dark' || tp === 'light' || tp === 'auto' ? tp : null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    themePreference,
    landingPreference: coerceLandingPreference(u.landingPreference),
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Met à jour les champs modifiables du user. Réservé aux champs
 * non-sensibles (préférences UI). Pour password / email un endpoint dédié
 * sera nécessaire (J5c).
 *
 * Conventions d'arguments :
 *  - une key absente du `patch` → le champ DB n'est pas touché
 *  - `themePreference: null` → reset explicite (le user retire sa pref)
 *  - `landingPreference` n'accepte pas null (NOT NULL en DB) — pour reset,
 *    passer 'home' explicitement.
 */
export async function updateUserPreferences(
  userId: string,
  patch: {
    themePreference?: 'dark' | 'light' | 'auto' | null;
    landingPreference?: LandingPreference;
  },
): Promise<User> {
  const db = getDb();
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (patch.themePreference !== undefined) {
    set.themePreference = patch.themePreference;
  }
  if (patch.landingPreference !== undefined) {
    set.landingPreference = patch.landingPreference;
  }
  const [updated] = await db.update(users).set(set).where(eq(users.id, userId)).returning();
  if (!updated) throw new AppError('RESOURCE_NOT_FOUND', { userId });
  return updated;
}

/**
 * Met à jour l'identité du user (displayName / email) — cf. ADR-033.
 *
 * - `email` est stocké tel quel (comme à l'inscription) mais l'unicité est
 *   case-insensitive (index `users_email_lower_idx`). On vérifie d'abord, puis
 *   on rattrape une éventuelle race via la violation d'unicité Postgres (23505)
 *   → `AUTH_EMAIL_TAKEN`.
 * - une key absente du `patch` → le champ DB n'est pas touché.
 */
export async function updateUserProfile(
  userId: string,
  patch: { displayName?: string; email?: string },
): Promise<User> {
  const db = getDb();
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.email !== undefined) {
    const existing = await findUserByEmailIndexed(patch.email);
    if (existing && existing.id !== userId) throw new AppError('AUTH_EMAIL_TAKEN');
    set.email = patch.email;
  }
  try {
    const [updated] = await db.update(users).set(set).where(eq(users.id, userId)).returning();
    if (!updated) throw new AppError('RESOURCE_NOT_FOUND', { userId });
    return updated;
  } catch (err) {
    if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
      throw new AppError('AUTH_EMAIL_TAKEN');
    }
    throw err;
  }
}

/**
 * Change le mot de passe du user (cf. ADR-033). Vérifie l'ancien (argon2),
 * hash le nouveau, puis révoque TOUS les refresh tokens du user (sécurité :
 * un changement de mot de passe met fin aux sessions). L'access token courant
 * (TTL court) reste valide jusqu'à expiration, après quoi un re-login est requis.
 */
export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const db = getDb();
  const user = await findUserById(userId);
  if (!user) throw new AppError('AUTH_NOT_AUTHENTICATED');
  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) throw new AppError('AUTH_INVALID_CREDENTIALS');
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  await revokeAllRefreshTokens(userId);
}

/** Priorité de succession à la propriété d'un groupe : owner > admin > member. */
const ROLE_RANK: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

/**
 * Supprime le compte du user (RGPD, droit à l'effacement — cf. ADR-033).
 *
 * Le point délicat : plusieurs FK vers `users.id` sont en `onDelete: 'restrict'`
 * (`groups.createdBy`, `events.createdBy`, `polls.createdBy`, `expenses.paidBy`,
 * `todoLists.createdBy`, `messagingProviderSessions.createdBy`). Une suppression
 * naïve échouerait. Dans une transaction unique :
 *
 *  1. Pour chaque groupe que le user touche (membre, propriétaire, ou auteur de
 *     contenu restrict), on choisit un SUCCESSEUR parmi les autres membres
 *     (admin prioritaire, sinon le plus ancien) :
 *       - s'il existe : on lui transfère la paternité des events/polls/expenses/
 *         todoLists du user dans ce groupe, et s'il s'agit d'un groupe possédé
 *         par le user on lui transfère aussi `groups.createdBy` + le rôle owner ;
 *       - sinon (membre unique) : on supprime le groupe (cascade contenu+membres).
 *  2. On supprime les sessions messageries (user-scoped, ADR-028).
 *  3. On supprime le user — le reste part en cascade (memberships, refresh
 *     tokens, rsvps, votes, shares, notifications, prefs, invitations) ou en
 *     set null (todoItems.assignee, activityLog.actor).
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  const db = getDb();
  const touchedGroupIds = await db.transaction(async (tx) => {
    // Groupes que le user touche, dédupliqués : membre, propriétaire, ou auteur
    // de contenu à FK restrict.
    const gidRows = (
      await Promise.all([
        tx
          .select({ gid: groupMembers.groupId })
          .from(groupMembers)
          .where(eq(groupMembers.userId, userId)),
        tx.select({ gid: groups.id }).from(groups).where(eq(groups.createdBy, userId)),
        tx.select({ gid: events.groupId }).from(events).where(eq(events.createdBy, userId)),
        tx.select({ gid: polls.groupId }).from(polls).where(eq(polls.createdBy, userId)),
        tx.select({ gid: expenses.groupId }).from(expenses).where(eq(expenses.paidBy, userId)),
        tx
          .select({ gid: todoLists.groupId })
          .from(todoLists)
          .where(eq(todoLists.createdBy, userId)),
      ])
    ).flat();
    const groupIds = [...new Set(gidRows.map((r) => r.gid))];

    for (const gid of groupIds) {
      const others = await tx
        .select({
          uid: groupMembers.userId,
          role: groupMembers.role,
          joinedAt: groupMembers.joinedAt,
        })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, gid), ne(groupMembers.userId, userId)));
      others.sort(
        (a, b) =>
          ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.joinedAt.getTime() - b.joinedAt.getTime(),
      );
      const successor = others[0]?.uid;

      const [grp] = await tx
        .select({ createdBy: groups.createdBy })
        .from(groups)
        .where(eq(groups.id, gid))
        .limit(1);
      if (!grp) continue;

      if (!successor) {
        // Membre unique → suppression du groupe (cascade contenu + membership).
        await tx.delete(groups).where(eq(groups.id, gid));
        continue;
      }

      // Transfert de la paternité des ressources restrict de ce groupe.
      await tx
        .update(events)
        .set({ createdBy: successor })
        .where(and(eq(events.groupId, gid), eq(events.createdBy, userId)));
      await tx
        .update(polls)
        .set({ createdBy: successor })
        .where(and(eq(polls.groupId, gid), eq(polls.createdBy, userId)));
      await tx
        .update(expenses)
        .set({ paidBy: successor })
        .where(and(eq(expenses.groupId, gid), eq(expenses.paidBy, userId)));
      await tx
        .update(todoLists)
        .set({ createdBy: successor })
        .where(and(eq(todoLists.groupId, gid), eq(todoLists.createdBy, userId)));

      if (grp.createdBy === userId) {
        await tx.update(groups).set({ createdBy: successor }).where(eq(groups.id, gid));
        await tx
          .update(groupMembers)
          .set({ role: 'owner' })
          .where(and(eq(groupMembers.groupId, gid), eq(groupMembers.userId, successor)));
      }
    }

    // Sessions messageries user-scoped (createdBy restrict) → suppression.
    await tx
      .delete(messagingProviderSessions)
      .where(eq(messagingProviderSessions.createdBy, userId));

    // Suppression finale du user (le reste part en cascade / set null).
    await tx.delete(users).where(eq(users.id, userId));

    return groupIds;
  });

  // Hors transaction (cache mémoire, rien à rollback dessus) et APRÈS commit :
  // le user quitte potentiellement plusieurs groupes ici (memberships,
  // successions, ou groupe supprimé) — sans ça le relay WS continuerait à
  // le compter comme destinataire jusqu'à 5 min (cf. MAN-17,
  // ws/membership-cache.ts).
  for (const gid of touchedGroupIds) {
    invalidateGroup(gid);
  }
}

export async function findUserByEmailIndexed(email: string): Promise<User | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return rows[0];
}

export async function findUserById(id: string): Promise<User | undefined> {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function findRefreshTokenByHash(tokenHash: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function revokeRefreshToken(id: string, replacedById?: string): Promise<void> {
  const db = getDb();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedById: replacedById ?? null })
    .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllRefreshTokens(userId: string): Promise<number> {
  const db = getDb();
  const updated = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return updated.length;
}

export async function getUserGroupIds(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  return rows.map((r) => r.groupId);
}

// ============================================================================
// Web mode helpers — cookie-based auth (cf. ADR-015)
// ============================================================================

/**
 * Nom du cookie qui transporte le refresh token en mode web.
 * httpOnly + Secure + SameSite=Strict + Path=/api/v1/auth.
 */
export const REFRESH_COOKIE = 'nexus_refresh';

const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Détecte si la requête est en mode web ou native.
 *
 * Ordre de détection :
 *  1. Header explicite `X-Nexus-Client: web` → web
 *  2. Présence d'un cookie `nexus_refresh` → web (l'user a une session)
 *  3. Sinon → native (mode body-token historique)
 */
export function detectClientMode(req: FastifyRequest): 'web' | 'native' {
  const header = req.headers['x-nexus-client'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && value.toLowerCase() === 'web') return 'web';

  const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
    .cookies;
  if (cookies?.[REFRESH_COOKIE]) return 'web';

  return 'native';
}

/**
 * Pose les deux cookies d'auth web : `nexus_refresh` (httpOnly) et
 * `nexus_csrf` (lisible par JS pour double-submit).
 */
export function setAuthCookies(reply: FastifyReply, refreshToken: string, csrfToken: string): void {
  const env = loadEnv();
  const ttlSec = Math.floor(parseTtlMs(env.JWT_REFRESH_TTL) / 1000);
  const isProd = env.NODE_ENV === 'production';

  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProd, // En dev (http://localhost) on tolère sans HTTPS
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: ttlSec,
  });

  reply.setCookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false, // Lisible par JS volontairement (double-submit)
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: ttlSec,
  });
}

/**
 * Supprime les deux cookies d'auth web (logout).
 * Important : il faut clear avec le même `path` que celui du set, sinon
 * le navigateur ne supprime rien.
 */
export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

/**
 * Lit le refresh token depuis le cookie `nexus_refresh`.
 * Renvoie `undefined` s'il est absent.
 */
export function readRefreshFromCookie(req: FastifyRequest): string | undefined {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
    .cookies;
  return cookies?.[REFRESH_COOKIE];
}
