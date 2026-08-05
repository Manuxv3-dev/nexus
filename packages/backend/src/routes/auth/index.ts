import { createHash } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

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
  EMAIL_MAX_LENGTH,
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
 * Nom de la variable d'env permettant, dans les seuls tests d'intégration qui
 * l'exercent explicitement, de désactiver le comportement quasi-illimité du
 * rate limit par email de `/forgot-password` en environnement de test. Ce
 * n'est PAS une variable de configuration production — volontairement absente
 * du schema `loadEnv` — juste un point d'injection pour
 * `auth.test.ts` (describe `rate limit par email`), qui pose une valeur
 * réduite le temps de ses deux tests puis la retire.
 */
const FORGOT_PASSWORD_EMAIL_RATE_LIMIT_TEST_MAX_ENV = 'FORGOT_PASSWORD_EMAIL_RATE_LIMIT_TEST_MAX';

/**
 * Seuil du rate limit PAR EMAIL de `/forgot-password` (MAN-172, phase 2 de
 * MAN-166). 5 requêtes / 15 min laisse une marge confortable pour un usage
 * légitime (lien perdu, clic raté, plusieurs onglets) tout en bornant le
 * bombardement de boîte mail d'une victime précise par un attaquant
 * multi-IP — cas que le rate limit par IP du scope parent ne couvre pas.
 *
 * TRADE-OFF ASSUMÉ : la clé étant l'email FOURNI par l'appelant (personne
 * n'est authentifié ici), n'importe qui peut griller le quota d'une victime
 * en 5 requêtes et la priver de reset pendant 15 min — un déni de service de
 * recouvrement de compte, renouvelable à ~20 req/h. C'est le compromis
 * standard de ce contrôle, et il est ici jugé moins grave que le
 * mail-bombing qu'il empêche : la victime garde son mot de passe et ses
 * sessions, et le blocage est borné dans le temps. `continueExceeding` reste
 * à `false` (défaut) précisément pour ça — pilonner ne prolonge PAS la
 * fenêtre. Si le cas devient réel, la parade sans réintroduire d'oracle
 * d'énumération est de renvoyer le lien EXISTANT tant qu'il est valide
 * plutôt que de bloquer la demande.
 *
 * Quasi illimité en test, sauf override explicite via
 * `FORGOT_PASSWORD_EMAIL_RATE_LIMIT_TEST_MAX`.
 */
function forgotPasswordEmailRateLimitMax(isTest: boolean): number {
  if (!isTest) return 5;
  // `Number.isFinite` plutôt qu'un simple test de vérité : une valeur non
  // numérique donnerait NaN, et `current > NaN` étant toujours faux, le rate
  // limit serait silencieusement désactivé au lieu d'échouer visiblement.
  const override = Number(process.env[FORGOT_PASSWORD_EMAIL_RATE_LIMIT_TEST_MAX_ENV]);
  return Number.isFinite(override) && override >= 0 ? override : 100_000;
}

/**
 * `keyGenerator` du rate limit par email de `/forgot-password`.
 *
 * Normalise en lowercase (l'email est ensuite résolu par
 * `findUserByEmailIndexed`, qui compare sur `lower(email)`) pour qu'une simple
 * variation de casse — que `EmailSchema` accepte telle quelle — ne suffise pas
 * à repartir d'un compteur neuf sur la même victime.
 *
 * La clé est le SHA-256 de l'email normalisé, jamais l'email en clair, pour
 * deux raisons :
 *  - **Borne mémoire.** Ce hook tourne en `preHandler`, donc AVANT le
 *    `parse()` Zod de `defineRoute` (qui a lieu dans le handler) : `req.body`
 *    est encore du JSON arbitraire, et `EmailSchema.max(254)` ne s'est pas
 *    appliqué. Une clé construite sur la valeur brute serait donc de taille
 *    attaquant-contrôlée jusqu'au `bodyLimit` (1 Mo, cf. server.ts) et
 *    resterait 15 min dans le LRU du store (5000 entrées, borné en NOMBRE
 *    d'entrées, pas en octets) — soit plusieurs Go retenus par un attaquant
 *    multi-IP, exactement le profil que ce rate limit est censé contrer. Le
 *    hash rend la clé de taille constante quoi qu'on envoie.
 *  - **Données perso.** Même raisonnement que `emailLogHash`
 *    (routes/waitlist/index.ts) : pas d'email en clair dans un store partagé,
 *    a fortiori le jour où il passera sur Redis.
 *
 * Au-delà de `EMAIL_MAX_LENGTH`, on ne hashe même pas : la requête sera de
 * toute façon rejetée en 400 par Zod, et la faire retomber sur la clé IP la
 * borne au même seuil au lieu de lui offrir un compteur neuf par valeur
 * envoyée. Même fallback si le body est absent ou si `email` n'est pas une
 * chaîne — ça évite de regrouper ces cas limites sous une clé constante
 * partagée par tous les appelants.
 */
function forgotPasswordEmailRateLimitKey(req: FastifyRequest): string {
  const body = req.body as { email?: unknown } | null | undefined;
  const raw = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (raw.length === 0 || raw.length > EMAIL_MAX_LENGTH) {
    return `forgot-password:ip:${req.ip}`;
  }
  return `forgot-password:email:${createHash('sha256').update(raw).digest('hex')}`;
}

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
    //
    // Rate limit PAR EMAIL, EN PLUS du rate limit par IP du scope parent
    // (MAN-172) : le rate limit IP borne un flood volumétrique depuis UNE
    // source, mais pas un attaquant multi-IP (botnet) qui viserait UNE
    // victime précise en bombardant sa boîte mail de liens de reset. Sous-
    // scope Fastify imbriqué, propre à cette seule route : `@fastify/
    // rate-limit` n'autorise qu'un enregistrement par scope avec sa propre
    // config, et les hooks d'un scope parent (le rate limit IP, en
    // `onRequest`) s'appliquent aux routes de ses enfants — donc les deux
    // limites s'appliquent cumulativement ici, sans dupliquer la config IP ni
    // toucher /reset-password. Cf. `forgotPasswordEmailRateLimitMax` /
    // `forgotPasswordEmailRateLimitKey` ci-dessus pour le choix du seuil et le
    // `keyGenerator`.
    await scope.register(async (forgotPasswordScope) => {
      await forgotPasswordScope.register(rateLimit, {
        max: () => forgotPasswordEmailRateLimitMax(isTest),
        timeWindow: '15 minutes',
        hook: 'preHandler',
        keyGenerator: forgotPasswordEmailRateLimitKey,
      });

      await forgotPasswordScope.register(
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
    });

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
