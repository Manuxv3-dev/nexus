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
});
