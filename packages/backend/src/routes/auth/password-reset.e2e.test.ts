/**
 * Test d'acceptation e2e du parcours complet « mot de passe oublié » (MAN-171
 * phase 1, dernière task de sous-ticket de MAN-166).
 *
 * Contrairement à `auth.test.ts` (qui teste `/forgot-password` et
 * `/reset-password` isolément, avec des jetons injectés/extraits par test),
 * ce fichier exerce la tranche verticale complète bout-en-bout via l'app
 * Fastify réellement montée, un seul parcours contigu :
 *
 *   POST /auth/register → POST /auth/forgot-password → (extraction du token
 *   depuis l'URL capturée sur le mock d'email) → POST /auth/reset-password →
 *   POST /auth/login avec le nouveau mot de passe (succès) → POST /auth/login
 *   avec l'ancien mot de passe (échec).
 *
 * `sendPasswordResetEmail` (Resend) est mocké — même pattern que
 * `auth.test.ts` (`vi.hoisted`, requis car `vi.mock` est hoisté au-dessus des
 * imports/const par vitest). Postgres reste réel (via `setupTestDb`). Skip
 * auto si Postgres n'est pas joignable (sandbox sans DB), même pattern que
 * les autres tests d'intégration du module.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';

const { sendPasswordResetEmailMock } = vi.hoisted(() => ({
  sendPasswordResetEmailMock: vi.fn(),
}));
vi.mock('../../core/email.js', () => ({
  sendPasswordResetEmail: sendPasswordResetEmailMock,
}));

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

/** Extrait le query param `token` de l'URL de reset capturée sur le mock. */
function extractTokenFromResetUrl(resetUrl: string): string {
  const match = /token=([^&]+)/.exec(resetUrl);
  if (!match?.[1]) throw new Error(`no token found in reset url: ${resetUrl}`);
  return match[1];
}

describe('password reset e2e — acceptation bout-en-bout (MAN-171)', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping password reset e2e test');
    return;
  }

  let testDb: TestDb;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await setupTestDb(BASE_DB_URL);
    setTestEnv();
    process.env['DATABASE_URL'] = testDb.url;
    const { resetEnvCache } = await import('../../core/env.js');
    resetEnvCache();

    const { buildServer } = await import('../../server.js');
    app = await buildServer();
  });

  afterAll(async () => {
    if (app) await app.close();
    const { closeDb } = await import('../../db/client.js');
    const { closeRedis } = await import('../../db/health.js');
    await closeDb();
    await closeRedis();
    if (testDb) await testDb.cleanup();
  });

  beforeEach(() => {
    sendPasswordResetEmailMock.mockReset();
    sendPasswordResetEmailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Retire l'override du seuil de rate limit par email pose par le test
    // `anti_abuse_e2e` — no-op pour les autres tests, qui ne le posent pas.
    delete process.env['FORGOT_PASSWORD_EMAIL_RATE_LIMIT_TEST_MAX'];
  });

  it('password_reset_e2e', async () => {
    const email = 'password-reset-e2e@ex.com';
    const oldPassword = 'a-very-long-original-password';
    const newPassword = 'a-brand-new-long-replacement-password';

    // 1. Enregistre un vrai user avec un mot de passe connu — vraie route HTTP.
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: oldPassword, displayName: 'PasswordResetE2E' },
    });
    expect(register.statusCode).toBe(200);

    // 2. POST /auth/forgot-password — déclenche l'envoi (mocké) de l'email de
    // reset, capture l'URL envoyée.
    const forgot = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email },
    });
    expect(forgot.statusCode).toBe(200);
    expect(forgot.json()).toEqual({ ok: true });

    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
    const [sentToEmail, resetUrl] = sendPasswordResetEmailMock.mock.calls[0] as [string, string];
    expect(sentToEmail).toBe(email);

    // 3. Extrait le jeton depuis l'URL capturée.
    const rawToken = extractTokenFromResetUrl(resetUrl);

    // 4. POST /auth/reset-password avec ce jeton + un nouveau mot de passe.
    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: rawToken, newPassword },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ ok: true });

    // 5. POST /auth/login avec le NOUVEAU mot de passe → succès, tokens renvoyés.
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: newPassword },
    });
    expect(newLogin.statusCode).toBe(200);
    const newLoginBody = newLogin.json<{ accessToken: string; refreshToken: string }>();
    expect(newLoginBody.accessToken).toBeTypeOf('string');
    expect(newLoginBody.refreshToken).toBeTypeOf('string');

    // 6. POST /auth/login avec l'ANCIEN mot de passe → échec.
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: oldPassword },
    });
    expect(oldLogin.statusCode).toBe(401);
    const oldLoginBody = oldLogin.json<{ error: { code: string } }>();
    expect(oldLoginBody.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  /**
   * Test d'acceptation e2e de la tranche anti-abus (MAN-172, phase 2 de
   * MAN-166), qui étend le parcours ci-dessus avec les deux garanties livrées
   * en Task 2/3 — déjà couvertes en isolation par `auth.test.ts`
   * (`test_forgot_password_invalidates_previous_token`, describe « rate limit
   * par email ») mais jamais exercées ici dans le parcours HTTP complet avec
   * un usage réel des jetons :
   *
   *  1. Deux demandes de reset successives pour le même email → seul le
   *     jeton de la DEUXIÈME fonctionne pour un vrai `/reset-password`, le
   *     premier est rejeté (`AUTH_RESET_TOKEN_INVALID`).
   *  2. Des demandes répétées et rapprochées pour le même email au-delà du
   *     seuil → la dernière est bloquée en 429. Seuil réduit via
   *     `FORGOT_PASSWORD_EMAIL_RATE_LIMIT_TEST_MAX` (même mécanisme que
   *     `auth.test.ts`) pour ne pas dépendre du seuil réel de prod (5) dans
   *     ce test.
   */
  it('anti_abuse_e2e', async () => {
    const email = 'password-reset-anti-abuse-e2e@ex.com';
    const password = 'a-very-long-anti-abuse-original-password';
    const newPassword = 'a-brand-new-long-anti-abuse-replacement-password';

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password, displayName: 'AntiAbuseE2E' },
    });

    // 1. Deux demandes de reset successives pour le même email — vraies
    // routes HTTP, capture des deux URLs/jetons envoyés.
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email },
    });
    expect(second.statusCode).toBe(200);

    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(2);
    const [, firstResetUrl] = sendPasswordResetEmailMock.mock.calls[0] as [string, string];
    const [, secondResetUrl] = sendPasswordResetEmailMock.mock.calls[1] as [string, string];
    const firstToken = extractTokenFromResetUrl(firstResetUrl);
    const secondToken = extractTokenFromResetUrl(secondResetUrl);
    expect(firstToken).not.toBe(secondToken);

    // Le jeton de la PREMIÈRE demande est invalidé par la seconde — un vrai
    // /reset-password avec ce jeton échoue.
    const resetWithFirstToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: firstToken, newPassword: 'attempt-with-stale-token-long-enough' },
    });
    expect(resetWithFirstToken.statusCode).toBe(400);
    expect(resetWithFirstToken.json<{ error: { code: string } }>().error.code).toBe(
      'AUTH_RESET_TOKEN_INVALID',
    );

    // Le jeton de la DEUXIÈME demande, lui, fonctionne bien bout-en-bout.
    const resetWithSecondToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: secondToken, newPassword },
    });
    expect(resetWithSecondToken.statusCode).toBe(200);
    expect(resetWithSecondToken.json()).toEqual({ ok: true });

    const loginWithNewPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: newPassword },
    });
    expect(loginWithNewPassword.statusCode).toBe(200);

    // 2. Rate limit par email : au-delà du seuil (réduit ici via la variable
    // de test dédiée), la dernière requête est bloquée en 429. Email distinct
    // du précédent pour ne pas mélanger les deux scénarios de ce parcours.
    process.env['FORGOT_PASSWORD_EMAIL_RATE_LIMIT_TEST_MAX'] = '3';
    const rateLimitedEmail = 'password-reset-anti-abuse-rate-limit-e2e@ex.com';

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: rateLimitedEmail, password, displayName: 'AntiAbuseRateLimitE2E' },
    });

    for (let i = 0; i < 3; i++) {
      const withinLimit = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: rateLimitedEmail },
      });
      expect(withinLimit.statusCode).toBe(200);
    }

    const rateLimited = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: rateLimitedEmail },
    });
    expect(rateLimited.statusCode).toBe(429);
  });

  /**
   * Test d'acceptation e2e des deux garanties de sécurité livrées en Phase 1
   * (MAN-171) mais jusqu'ici prouvées uniquement en isolation dans
   * `auth.test.ts` (`test_reset_password_revokes_existing_refresh_tokens`,
   * `test_reset_password_expired_token_rejected`,
   * `test_reset_password_already_used_token_rejected`) — jamais exercées
   * ensemble dans un même parcours HTTP bout-en-bout (MAN-173, Task 4) :
   *
   *  1. Révocation de session : un refresh token obtenu via un vrai
   *     `/auth/login` AVANT le reset ne permet plus de renouveler l'access
   *     token APRÈS un reset réussi — `/auth/refresh` renvoie 401. C'est la
   *     garantie qui fait du reset un vrai mécanisme de récupération de
   *     compte compromis (un attaquant avec une session déjà ouverte ne
   *     survit pas à la "récupération" de la victime).
   *  2. Anti-énumération : un jeton expiré et un jeton déjà utilisé sont
   *     rejetés sous EXACTEMENT le même code d'erreur
   *     (`AUTH_RESET_TOKEN_INVALID`, 400) — aucune distinction de code entre
   *     les cas, pour ne rien révéler côté client sur la raison précise du
   *     rejet.
   */
  it('session_revocation_and_invalid_link_e2e', async () => {
    const email = 'session-revocation-e2e@ex.com';
    const password = 'a-very-long-session-revocation-password';
    const newPassword = 'a-brand-new-long-session-revocation-password';

    // 0. Enregistre un vrai user — vraie route HTTP.
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password, displayName: 'SessionRevocationE2E' },
    });
    expect(register.statusCode).toBe(200);
    const { user } = register.json<{ user: { id: string } }>();

    // 1. Le user se connecte — vrai /auth/login en mode non-web (pas de
    // header X-Nexus-Client), le refreshToken est donc renvoyé dans le body.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const { refreshToken } = login.json<{ refreshToken: string }>();
    expect(refreshToken).toBeTypeOf('string');

    // Confirme que ce refresh token fonctionne bien AVANT le reset — sinon
    // l'assertion « révoqué après reset » à l'étape 3 serait un faux positif
    // (un token qui ne marchait déjà pas).
    const refreshBeforeReset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshBeforeReset.statusCode).toBe(200);

    // 2. Demande et effectue un reset de mot de passe réussi — vraies routes
    // HTTP, jeton capturé depuis l'URL envoyée sur le mock d'email.
    const forgot = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email },
    });
    expect(forgot.statusCode).toBe(200);
    const [, resetUrl] = sendPasswordResetEmailMock.mock.calls[0] as [string, string];
    const rawToken = extractTokenFromResetUrl(resetUrl);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: rawToken, newPassword },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ ok: true });

    // 3. Le refresh token obtenu à l'étape 1, lui, est désormais révoqué —
    // un /auth/refresh avec ce même token renvoie 401.
    const refreshAfterReset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshAfterReset.statusCode).toBe(401);

    // 4a. Jeton expiré (inséré directement en base, comme
    // `test_reset_password_expired_token_rejected` dans auth.test.ts) →
    // AUTH_RESET_TOKEN_INVALID.
    const { getDb } = await import('../../db/client.js');
    const { passwordResetTokens } = await import('../../db/schema/index.js');
    const { hashResetToken } = await import('./service.js');

    const expiredRawToken = 'session-revocation-e2e-expired-raw-token';
    await getDb()
      .insert(passwordResetTokens)
      .values({
        userId: user.id,
        tokenHash: hashResetToken(expiredRawToken),
        expiresAt: new Date(Date.now() - 60 * 1000),
      });

    const resetWithExpiredToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: expiredRawToken, newPassword: 'attempt-with-expired-token-long-enough' },
    });
    expect(resetWithExpiredToken.statusCode).toBe(400);
    expect(resetWithExpiredToken.json<{ error: { code: string } }>().error.code).toBe(
      'AUTH_RESET_TOKEN_INVALID',
    );

    // 4b. Jeton déjà utilisé (inséré directement en base avec `usedAt` posé,
    // comme `test_reset_password_already_used_token_rejected` dans
    // auth.test.ts) → EXACTEMENT le même code d'erreur que le jeton expiré,
    // ci-dessus — c'est la preuve que l'anti-énumération tient.
    const usedRawToken = 'session-revocation-e2e-already-used-raw-token';
    await getDb()
      .insert(passwordResetTokens)
      .values({
        userId: user.id,
        tokenHash: hashResetToken(usedRawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: new Date(),
      });

    const resetWithUsedToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: usedRawToken, newPassword: 'attempt-with-used-token-long-enough' },
    });
    expect(resetWithUsedToken.statusCode).toBe(400);
    expect(resetWithUsedToken.json<{ error: { code: string } }>().error.code).toBe(
      'AUTH_RESET_TOKEN_INVALID',
    );

    // Les deux jetons invalides renvoient le même code : anti-énumération
    // préservée (pas de canal pour distinguer expiré / déjà utilisé /
    // inconnu depuis la réponse HTTP).
    expect(resetWithExpiredToken.json<{ error: { code: string } }>().error.code).toBe(
      resetWithUsedToken.json<{ error: { code: string } }>().error.code,
    );

    // Sanity check final : la table contient bien les jetons insérés pour ce
    // user (pas de faux-positif dû à une insertion silencieusement ratée).
    const insertedTokens = await getDb()
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));
    expect(insertedTokens.length).toBeGreaterThanOrEqual(2);
  });
});
