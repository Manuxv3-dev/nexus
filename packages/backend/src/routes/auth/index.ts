import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema/index.js';

import {
  LoginBodySchema,
  LoginReplySchema,
  LogoutAllReplySchema,
  LogoutBodySchema,
  LogoutReplySchema,
  MeReplySchema,
  RefreshBodySchema,
  RefreshReplySchema,
  RegisterBodySchema,
  RegisterReplySchema,
} from './schemas.js';
import {
  findRefreshTokenByHash,
  findUserByEmailIndexed,
  findUserById,
  getUserGroupIds,
  hashPassword,
  hashRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  signAccessToken,
  userToDto,
  verifyPassword,
} from './service.js';

/**
 * Plugin Fastify regroupant tous les endpoints /api/v1/auth.
 *
 * Cf. ADR-004 pour la stratégie auth (JWT access court + refresh DB-backed
 * avec rotation et détection de réutilisation).
 */
export const authPlugin: FastifyPluginAsync = async (app) => {
  // ----- POST /api/v1/auth/register ------------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/auth/register',
      body: RegisterBodySchema,
      reply: RegisterReplySchema,
      handler: async (req) => {
        const existing = await findUserByEmailIndexed(req.body.email);
        if (existing) throw new AppError('AUTH_EMAIL_TAKEN');

        const passwordHash = await hashPassword(req.body.password);
        const db = getDb();
        const [created] = await db
          .insert(users)
          .values({
            email: req.body.email,
            passwordHash,
            displayName: req.body.displayName,
          })
          .returning();

        if (!created) throw new AppError('INTERNAL_ERROR');

        const groupIds: string[] = []; // user fraîchement créé, pas de groupe
        const { raw: refreshToken } = await issueRefreshToken({
          userId: created.id,
          userAgent: req.headers['user-agent'] ?? null,
          ipAddress: req.ip,
        });

        return {
          user: userToDto(created),
          accessToken: signAccessToken(created.id, groupIds),
          refreshToken,
        };
      },
    }),
  );

  // ----- POST /api/v1/auth/login ---------------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: LoginBodySchema,
      reply: LoginReplySchema,
      handler: async (req) => {
        const user = await findUserByEmailIndexed(req.body.email);
        if (!user) {
          // Vérification dummy pour timing-safe
          await hashPassword('placeholder-to-burn-time');
          throw new AppError('AUTH_INVALID_CREDENTIALS');
        }
        const ok = await verifyPassword(user.passwordHash, req.body.password);
        if (!ok) throw new AppError('AUTH_INVALID_CREDENTIALS');

        const groupIds = await getUserGroupIds(user.id);
        const { raw: refreshToken } = await issueRefreshToken({
          userId: user.id,
          deviceId: req.body.deviceId ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          ipAddress: req.ip,
        });

        return {
          user: userToDto(user),
          accessToken: signAccessToken(user.id, groupIds),
          refreshToken,
        };
      },
    }),
  );

  // ----- POST /api/v1/auth/refresh -------------------------------------------
  // Rotation systématique. Détection de réutilisation = revoke all chain.
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      body: RefreshBodySchema,
      reply: RefreshReplySchema,
      handler: async (req) => {
        const tokenHash = hashRefreshToken(req.body.refreshToken);
        const stored = await findRefreshTokenByHash(tokenHash);

        if (!stored) {
          throw new AppError('AUTH_TOKEN_INVALID');
        }

        // Détection de réutilisation : si déjà révoqué = signal de vol
        if (stored.revokedAt !== null) {
          await revokeAllRefreshTokens(stored.userId);
          throw new AppError('AUTH_REFRESH_REUSED');
        }

        if (stored.expiresAt.getTime() < Date.now()) {
          throw new AppError('AUTH_TOKEN_EXPIRED');
        }

        const groupIds = await getUserGroupIds(stored.userId);

        const { raw: newRefresh, id: newId } = await issueRefreshToken({
          userId: stored.userId,
          deviceId: stored.deviceId,
          userAgent: req.headers['user-agent'] ?? null,
          ipAddress: req.ip,
        });
        await revokeRefreshToken(stored.id, newId);

        return {
          accessToken: signAccessToken(stored.userId, groupIds),
          refreshToken: newRefresh,
        };
      },
    }),
  );

  // ----- POST /api/v1/auth/logout --------------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/auth/logout',
      body: LogoutBodySchema,
      reply: LogoutReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const tokenHash = hashRefreshToken(req.body.refreshToken);
        const stored = await findRefreshTokenByHash(tokenHash);
        if (stored && stored.userId === req.user?.id && stored.revokedAt === null) {
          await revokeRefreshToken(stored.id);
        }
        return { ok: true as const };
      },
    }),
  );

  // ----- POST /api/v1/auth/logout-all ----------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/auth/logout-all',
      reply: LogoutAllReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        const revokedCount = await revokeAllRefreshTokens(userId);
        return { revokedCount };
      },
    }),
  );

  // ----- GET /api/v1/auth/me -------------------------------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/auth/me',
      reply: MeReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        const user = await findUserById(userId);
        if (!user) throw new AppError('AUTH_NOT_AUTHENTICATED');
        return { user: userToDto(user) };
      },
    }),
  );
};
