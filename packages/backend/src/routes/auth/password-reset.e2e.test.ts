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
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
