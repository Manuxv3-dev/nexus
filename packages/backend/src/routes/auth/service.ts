import { createHash, randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

import { CSRF_COOKIE } from '../../core/csrf.js';
import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';
import { getDb } from '../../db/client.js';
import { groupMembers, refreshTokens, users, type User } from '../../db/schema/index.js';

import type { UserDto } from './schemas.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

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

export function generateRefreshToken(): string {
  return randomUUID();
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function parseTtlMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match || !match[1] || !match[2]) {
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

export function userToDto(u: User): UserDto {
  // theme_preference est text en DB ; on cast en enum si valide, sinon null
  // (defensive : un audit accidentel ne plante pas la route).
  const tp = u.themePreference;
  const themePreference =
    tp === 'dark' || tp === 'light' || tp === 'auto' ? tp : null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    themePreference,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Met à jour les champs modifiables du user. Réservé aux champs
 * non-sensibles (préférences UI). Pour password / email un endpoint dédié
 * sera nécessaire (J5c).
 */
export async function updateUserPreferences(
  userId: string,
  patch: { themePreference?: 'dark' | 'light' | 'auto' | null },
): Promise<User> {
  const db = getDb();
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (patch.themePreference !== undefined) {
    set.themePreference = patch.themePreference;
  }
  const [updated] = await db
    .update(users)
    .set(set)
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new AppError('RESOURCE_NOT_FOUND', { userId });
  return updated;
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
export function setAuthCookies(
  reply: FastifyReply,
  refreshToken: string,
  csrfToken: string,
): void {
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
