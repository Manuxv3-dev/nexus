import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { validateCsrf } from '../../core/csrf.js';
import { generateCsrfToken } from '../../core/csrf.js';
import { defineRoute } from '../../core/define-route.js';
import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema/index.js';

import {
  ChangePasswordBodySchema,
  ForgotPasswordBodySchema,
  LoginBodySchema,
  LoginReplySchema,
  LogoutAllReplySchema,
  LogoutBodySchema,
  LogoutReplySchema,
  MeReplySchema,
  OkReplySchema,
  RefreshBodySchema,
  RefreshReplySchema,
  RegisterBodySchema,
  RegisterReplySchema,
  ResetPasswordBodySchema,
  UpdateMeBodySchema,
} from './schemas.js';
import {
  changeUserPassword,
  clearAuthCookies,
  deleteUserAccount,
  detectClientMode,
  findRefreshTokenByHash,
  findUserByEmailIndexed,
  findUserById,
  getUserGroupIds,
  hashPassword,
  hashRefreshToken,
  issueRefreshToken,
  readRefreshFromCookie,
  requestPasswordReset,
  resetPassword,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  setAuthCookies,
  signAccessToken,
  updateUserPreferences,
  updateUserProfile,
  userToDto,
  verifyPassword,
} from './service.js';

/**
 * Plugin Fastify regroupant tous les endpoints /api/v1/auth.
 *
 * Cf. ADR-004 (stratégie auth : JWT access court + refresh DB-backed avec
 * rotation et détection de réutilisation) et ADR-015 (mode web cookie +
 * CSRF en complément du mode native body-token).
 *
 * Détection du mode (cf. `detectClientMode`) :
 *  - header `X-Nexus-Client: web` ou cookie `nexus_refresh` présent → web
 *  - sinon → native
 */
export const authPlugin: FastifyPluginAsync = async (app) => {
  // ----- POST /api/v1/auth/register ------------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/auth/register',
      body: RegisterBodySchema,
      reply: RegisterReplySchema,
      handler: async (req, reply) => {
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

        const groupIds: string[] = []; // user fraîchement créé
        const { raw: refreshToken } = await issueRefreshToken({
          userId: created.id,
          userAgent: req.headers['user-agent'] ?? null,
          ipAddress: req.ip,
        });

        const accessToken = signAccessToken(created.id, groupIds);
        const mode = detectClientMode(req);

        if (mode === 'web') {
          const csrfToken = generateCsrfToken();
          setAuthCookies(reply, refreshToken, csrfToken);
          return { user: userToDto(created), accessToken };
        }
        return { user: userToDto(created), accessToken, refreshToken };
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
      handler: async (req, reply) => {
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

        const accessToken = signAccessToken(user.id, groupIds);
        const mode = detectClientMode(req);

        if (mode === 'web') {
          const csrfToken = generateCsrfToken();
          setAuthCookies(reply, refreshToken, csrfToken);
          return { user: userToDto(user), accessToken };
        }
        return { user: userToDto(user), accessToken, refreshToken };
      },
    }),
  );

  // ----- Reset de mot de passe (endpoints publics) ---------------------------
  // Les deux seules routes auth non authentifiées qui écrivent en base ET
  // déclenchent un envoi d'email vers un tiers (Resend) à partir d'une adresse
  // fournie par l'appelant. Sans limite, /forgot-password est à la fois un
  // canon à spam (bombarder la boîte d'une victime), un robinet à facture
  // Resend, et l'outil d'énumération de comptes le plus pratique du serveur
  // (mesure du timing). Rate limit local à ce sous-scope, même pattern et
  // même justification que `waitlistPlugin` (routes/waitlist/index.ts) : le
  // plugin n'est pas câblé globalement, et on ne veut surtout pas limiter
  // /login ou /refresh au passage.
  await app.register(async (scope) => {
    // Quasi illimité en test : les suites d'intégration enchaînent bien plus
    // de requêtes que ça depuis la même IP simulée.
    const isTest = loadEnv().NODE_ENV === 'test';
    await scope.register(rateLimit, { max: isTest ? 100_000 : 10, timeWindow: '15 minutes' });

    // ----- POST /api/v1/auth/forgot-password ---------------------------------
    // Endpoint public (pas de requireAuth) : déclenche l'envoi d'un email de
    // reset si le compte existe. Réponse identique { ok: true } dans TOUS les
    // cas — email connu, inconnu, ou échec réel de l'envoi (Resend absent /
    // mal configuré / en erreur). Un 500 sur ce dernier cas ferait de la route
    // un oracle d'énumération : cf. la JSDoc de `requestPasswordReset`
    // (routes/auth/service.ts) pour l'argumentaire complet.
    await scope.register(
      defineRoute({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        body: ForgotPasswordBodySchema,
        reply: OkReplySchema,
        handler: async (req) => {
          await requestPasswordReset(req.body.email);
          return { ok: true as const };
        },
      }),
    );

    // ----- POST /api/v1/auth/reset-password ----------------------------------
    // Endpoint public (pas de requireAuth) : consomme le jeton émis par
    // /auth/forgot-password, applique le nouveau mot de passe, et révoque
    // toutes les sessions existantes (cf. JSDoc de `resetPassword`,
    // routes/auth/service.ts). L'UX de lien invalide/expiré affinée reste
    // posée en Phase 3, MAN-173.
    await scope.register(
      defineRoute({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        body: ResetPasswordBodySchema,
        reply: OkReplySchema,
        handler: async (req) => {
          await resetPassword(req.body.token, req.body.newPassword);
          return { ok: true as const };
        },
      }),
    );
  });

  // ----- POST /api/v1/auth/refresh -------------------------------------------
  // Rotation systématique. Détection de réutilisation = revoke all chain.
  // Supporte les deux modes (cf. ADR-015).
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      body: RefreshBodySchema,
      reply: RefreshReplySchema,
      handler: async (req, reply) => {
        const mode = detectClientMode(req);
        const bodyToken = req.body.refreshToken;
        const cookieToken = readRefreshFromCookie(req);

        // Erreur si les deux sources sont fournies (configuration ambiguë,
        // potentielle attaque) ou si aucune.
        if (bodyToken && cookieToken) {
          throw new AppError('VALIDATION_ERROR', { reason: 'ambiguous_token_sources' });
        }
        const rawToken = bodyToken ?? cookieToken;
        if (!rawToken) {
          throw new AppError('AUTH_TOKEN_INVALID');
        }

        // Mode web : valider CSRF avant tout autre traitement
        if (mode === 'web') {
          validateCsrf(req);
        }

        const tokenHash = hashRefreshToken(rawToken);
        const stored = await findRefreshTokenByHash(tokenHash);

        if (!stored) {
          throw new AppError('AUTH_TOKEN_INVALID');
        }

        // Détection de réutilisation : token déjà révoqué = signal de vol
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

        const accessToken = signAccessToken(stored.userId, groupIds);

        if (mode === 'web') {
          const csrfToken = generateCsrfToken();
          setAuthCookies(reply, newRefresh, csrfToken);
          return { accessToken };
        }
        return { accessToken, refreshToken: newRefresh };
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
      handler: async (req, reply) => {
        const mode = detectClientMode(req);
        const bodyToken = req.body.refreshToken;
        const cookieToken = readRefreshFromCookie(req);

        if (bodyToken && cookieToken) {
          throw new AppError('VALIDATION_ERROR', { reason: 'ambiguous_token_sources' });
        }
        const rawToken = bodyToken ?? cookieToken;

        // Mode web : valider CSRF
        if (mode === 'web') {
          validateCsrf(req);
        }

        if (rawToken) {
          const tokenHash = hashRefreshToken(rawToken);
          const stored = await findRefreshTokenByHash(tokenHash);
          if (stored && stored.userId === req.user?.id && stored.revokedAt === null) {
            await revokeRefreshToken(stored.id);
          }
        }

        if (mode === 'web') {
          clearAuthCookies(reply);
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
      handler: async (req, reply) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');

        const mode = detectClientMode(req);
        if (mode === 'web') {
          validateCsrf(req);
        }

        const revokedCount = await revokeAllRefreshTokens(userId);

        if (mode === 'web') {
          clearAuthCookies(reply);
        }
        return { revokedCount };
      },
    }),
  );

  // ----- GET /api/v1/auth/me -------------------------------------------------
  // Lecture seule, authentifiée via Bearer access token. Pas de CSRF requis
  // (l'access token est en mémoire JS, pas dans un cookie).
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

  // ----- PATCH /api/v1/auth/me -----------------------------------------------
  // Préférences UI (J5b #50 + ADR-024 #69) : `themePreference`, `landingPreference`.
  // Identité (ADR-033) : `displayName`, `email` (unicité → AUTH_EMAIL_TAKEN 409).
  // Pas de CSRF (cohérent avec le comportement historique de cette route ;
  // l'access token Bearer suffit). Les mutations sensibles (change-password,
  // delete) ajoutent le CSRF en mode web.
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      body: UpdateMeBodySchema,
      reply: MeReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        // exactOptionalPropertyTypes : on construit les patchs en omettant les
        // keys absentes pour ne pas écrire `undefined`.
        const profilePatch: Parameters<typeof updateUserProfile>[1] = {};
        if (req.body.displayName !== undefined) profilePatch.displayName = req.body.displayName;
        if (req.body.email !== undefined) profilePatch.email = req.body.email;

        const prefsPatch: Parameters<typeof updateUserPreferences>[1] = {};
        if ('themePreference' in req.body) {
          prefsPatch.themePreference = req.body.themePreference ?? null;
        }
        if ('landingPreference' in req.body && req.body.landingPreference !== undefined) {
          prefsPatch.landingPreference = req.body.landingPreference;
        }

        let current = await findUserById(userId);
        if (!current) throw new AppError('AUTH_NOT_AUTHENTICATED');
        if (Object.keys(profilePatch).length > 0) {
          current = await updateUserProfile(userId, profilePatch);
        }
        if (Object.keys(prefsPatch).length > 0) {
          current = await updateUserPreferences(userId, prefsPatch);
        }
        return { user: userToDto(current) };
      },
    }),
  );

  // ----- POST /api/v1/auth/change-password -----------------------------------
  // Vérifie l'ancien mot de passe, hash le nouveau, révoque tous les refresh
  // tokens (fin des autres sessions ; l'access token courant vit son TTL court).
  // Mode web → CSRF requis (mutation sensible, aligné sur logout-all).
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      body: ChangePasswordBodySchema,
      reply: OkReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        if (detectClientMode(req) === 'web') validateCsrf(req);
        await changeUserPassword(userId, req.body.currentPassword, req.body.newPassword);
        return { ok: true as const };
      },
    }),
  );

  // ----- DELETE /api/v1/auth/me ----------------------------------------------
  // Suppression de compte (RGPD, droit à l'effacement — cf. ADR-033). Transfère
  // la propriété des groupes/ressources restrict au plus ancien autre membre
  // (admin prioritaire) ou supprime le groupe si membre unique, puis supprime
  // le user. Mode web → CSRF requis + clear cookies.
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      reply: OkReplySchema,
      preHandlers: [requireAuth],
      handler: async (req, reply) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        const mode = detectClientMode(req);
        if (mode === 'web') validateCsrf(req);
        await deleteUserAccount(userId);
        if (mode === 'web') clearAuthCookies(reply);
        return { ok: true as const };
      },
    }),
  );
};
