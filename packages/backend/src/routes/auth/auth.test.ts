import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';

/**
 * `sendPasswordResetEmail` (Resend) est mocké pour tout ce fichier : aucun
 * test d'intégration auth ne doit dépendre d'un vrai appel réseau, et
 * `RESEND_API_KEY`/`EMAIL_FROM` ne sont volontairement pas posés par
 * `setTestEnv` (cf. sa JSDoc). `vi.hoisted` est requis car `vi.mock` est
 * hoisté au-dessus des imports/const par vitest.
 */
const { sendPasswordResetEmailMock } = vi.hoisted(() => ({
  sendPasswordResetEmailMock: vi.fn(),
}));
vi.mock('../../core/email.js', () => ({
  sendPasswordResetEmail: sendPasswordResetEmailMock,
}));

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

/**
 * Tests d'intégration auth.
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 * En CI, Postgres tourne en service container — les tests passent.
 */
describe('auth endpoints', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping auth integration tests');
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

  describe('POST /auth/register', () => {
    it('crée un user et retourne un couple de tokens', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'manu@example.com',
          password: 'a-very-long-password',
          displayName: 'Manu',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        user: { id: string; email: string };
        accessToken: string;
        refreshToken: string;
      }>();
      expect(body.user.email).toBe('manu@example.com');
      expect(body.accessToken).toBeTypeOf('string');
      expect(body.refreshToken).toBeTypeOf('string');
    });

    it('refuse un email déjà pris (case-insensitive)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'MANU@example.com',
          password: 'another-very-long-password',
          displayName: 'Doublon',
        },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_EMAIL_TAKEN');
    });

    it('refuse un password court avec VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'short@example.com', password: 'shortpw', displayName: 'X' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('accepte les bons credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'manu@example.com', password: 'a-very-long-password' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('refuse un mauvais password (AUTH_INVALID_CREDENTIALS)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'manu@example.com', password: 'wrong-but-long-password' },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('refuse un email inconnu (AUTH_INVALID_CREDENTIALS, pas leak)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@example.com', password: 'whatever-long-password' },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  describe('POST /auth/refresh — rotation et détection de réutilisation', () => {
    it("échange un refresh contre un nouveau couple, et révoque l'ancien", async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'manu@example.com', password: 'a-very-long-password' },
      });
      const original = login.json<{ refreshToken: string }>();

      const refresh1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: original.refreshToken },
      });
      expect(refresh1.statusCode).toBe(200);

      // Réutiliser l'ancien refresh = AUTH_REFRESH_REUSED + revoke all
      const reuse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: original.refreshToken },
      });
      expect(reuse.statusCode).toBe(401);
      const reuseBody = reuse.json<{ error: { code: string } }>();
      expect(reuseBody.error.code).toBe('AUTH_REFRESH_REUSED');

      // Le nouveau refresh est lui aussi maintenant révoqué (revoke all chain)
      const newToken = refresh1.json<{ refreshToken: string }>().refreshToken;
      const afterRevokeAll = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: newToken },
      });
      expect(afterRevokeAll.statusCode).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    it('refuse sans Bearer token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('renvoie le user courant avec un access token valide', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'manu@example.com', password: 'a-very-long-password' },
      });
      const { accessToken } = login.json<{ accessToken: string }>();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ user: { email: string } }>();
      expect(body.user.email).toBe('manu@example.com');
    });
  });

  describe('auth — mode web (cookie + CSRF, ADR-015)', () => {
    /**
     * Helper : extrait la valeur d'un cookie depuis Set-Cookie array.
     * Cookie format: "name=value; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=..."
     */
    function getCookie(
      setCookieHeader: string | string[] | undefined,
      name: string,
    ): string | null {
      if (!setCookieHeader) return null;
      const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      for (const raw of arr) {
        const match = new RegExp(`^${name}=([^;]+)`).exec(raw);
        if (match?.[1]) return match[1];
      }
      return null;
    }

    function getCookieAttrs(setCookieHeader: string | string[] | undefined, name: string): string {
      if (!setCookieHeader) return '';
      const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      for (const raw of arr) {
        if (raw.startsWith(`${name}=`)) return raw;
      }
      return '';
    }

    it("register en mode web pose les cookies et n'inclut pas refreshToken dans le body", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-nexus-client': 'web' },
        payload: {
          email: 'web1@example.com',
          password: 'a-very-long-password',
          displayName: 'Web1',
        },
      });
      expect(res.statusCode).toBe(200);

      const setCookie = res.headers['set-cookie'];
      const refreshAttrs = getCookieAttrs(setCookie, 'nexus_refresh');
      const csrfAttrs = getCookieAttrs(setCookie, 'nexus_csrf');
      expect(refreshAttrs).toMatch(/HttpOnly/i);
      expect(refreshAttrs).toMatch(/SameSite=Strict/i);
      expect(refreshAttrs).toMatch(/Path=\/api\/v1\/auth/);
      expect(csrfAttrs).toMatch(/SameSite=Strict/i);
      // CSRF ne doit PAS être HttpOnly (lisible par JS pour double-submit)
      expect(csrfAttrs).not.toMatch(/HttpOnly/i);

      const body = res.json<{ accessToken: string; refreshToken?: string }>();
      expect(body.accessToken).toBeTypeOf('string');
      expect(body.refreshToken).toBeUndefined();
    });

    it('login en mode web pose les cookies', async () => {
      // user déjà créé au test précédent
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-nexus-client': 'web' },
        payload: { email: 'web1@example.com', password: 'a-very-long-password' },
      });
      expect(res.statusCode).toBe(200);
      const refresh = getCookie(res.headers['set-cookie'], 'nexus_refresh');
      const csrf = getCookie(res.headers['set-cookie'], 'nexus_csrf');
      expect(refresh).toBeTypeOf('string');
      expect(csrf).toBeTypeOf('string');
      const body = res.json<{ refreshToken?: string }>();
      expect(body.refreshToken).toBeUndefined();
    });

    it('refresh en mode web : cookie + header CSRF → 200 + nouveaux cookies', async () => {
      // Register pour obtenir une session web fraîche
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-nexus-client': 'web' },
        payload: {
          email: 'web2@example.com',
          password: 'a-very-long-password',
          displayName: 'Web2',
        },
      });
      const refreshCookie = getCookie(reg.headers['set-cookie'], 'nexus_refresh');
      const csrfCookie = getCookie(reg.headers['set-cookie'], 'nexus_csrf');
      expect(refreshCookie).toBeTruthy();
      expect(csrfCookie).toBeTruthy();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `nexus_refresh=${refreshCookie}; nexus_csrf=${csrfCookie}`,
          'x-csrf-token': csrfCookie!,
        },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ accessToken: string; refreshToken?: string }>();
      expect(body.accessToken).toBeTypeOf('string');
      expect(body.refreshToken).toBeUndefined(); // mode web → pas dans le body

      // Nouveau cookie refresh posé (rotation)
      const newRefresh = getCookie(res.headers['set-cookie'], 'nexus_refresh');
      expect(newRefresh).toBeTruthy();
      expect(newRefresh).not.toBe(refreshCookie);
    });

    it('refresh en mode web sans header CSRF → 403 AUTH_CSRF_MISMATCH', async () => {
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-nexus-client': 'web' },
        payload: {
          email: 'web3@example.com',
          password: 'a-very-long-password',
          displayName: 'Web3',
        },
      });
      const refreshCookie = getCookie(reg.headers['set-cookie'], 'nexus_refresh');
      const csrfCookie = getCookie(reg.headers['set-cookie'], 'nexus_csrf');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `nexus_refresh=${refreshCookie}; nexus_csrf=${csrfCookie}`,
          // pas de x-csrf-token header
        },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_CSRF_MISMATCH');
    });

    it('refresh en mode web avec mauvais header CSRF → 403', async () => {
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-nexus-client': 'web' },
        payload: {
          email: 'web4@example.com',
          password: 'a-very-long-password',
          displayName: 'Web4',
        },
      });
      const refreshCookie = getCookie(reg.headers['set-cookie'], 'nexus_refresh');
      const csrfCookie = getCookie(reg.headers['set-cookie'], 'nexus_csrf');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `nexus_refresh=${refreshCookie}; nexus_csrf=${csrfCookie}`,
          'x-csrf-token': 'forged-csrf-token-by-attacker',
        },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_CSRF_MISMATCH');
    });

    it('refresh avec body + cookie simultanément → VALIDATION_ERROR', async () => {
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-nexus-client': 'web' },
        payload: {
          email: 'web5@example.com',
          password: 'a-very-long-password',
          displayName: 'Web5',
        },
      });
      const refreshCookie = getCookie(reg.headers['set-cookie'], 'nexus_refresh');
      const csrfCookie = getCookie(reg.headers['set-cookie'], 'nexus_csrf');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `nexus_refresh=${refreshCookie}; nexus_csrf=${csrfCookie}`,
          'x-csrf-token': csrfCookie!,
        },
        payload: { refreshToken: 'some-other-token' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('logout en mode web : cookies vidés et refresh révoqué', async () => {
      // Setup
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-nexus-client': 'web' },
        payload: {
          email: 'web6@example.com',
          password: 'a-very-long-password',
          displayName: 'Web6',
        },
      });
      const refreshCookie = getCookie(reg.headers['set-cookie'], 'nexus_refresh');
      const csrfCookie = getCookie(reg.headers['set-cookie'], 'nexus_csrf');
      const { accessToken } = reg.json<{ accessToken: string }>();

      const logout = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: `nexus_refresh=${refreshCookie}; nexus_csrf=${csrfCookie}`,
          'x-csrf-token': csrfCookie!,
          authorization: `Bearer ${accessToken}`,
        },
        payload: {},
      });
      expect(logout.statusCode).toBe(200);

      // Cookies clear (Max-Age=0 ou Expires past)
      const clearedRefresh = getCookieAttrs(logout.headers['set-cookie'], 'nexus_refresh');
      const clearedCsrf = getCookieAttrs(logout.headers['set-cookie'], 'nexus_csrf');
      expect(clearedRefresh).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
      expect(clearedCsrf).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);

      // Le refresh ne marche plus
      const after = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `nexus_refresh=${refreshCookie}; nexus_csrf=${csrfCookie}`,
          'x-csrf-token': csrfCookie!,
        },
        payload: {},
      });
      expect(after.statusCode).toBe(401);
    });

    it('mode native (body-token) inchangé : login sans X-Nexus-Client retourne refreshToken', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'native1@example.com',
          password: 'a-very-long-password',
          displayName: 'Native1',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ accessToken: string; refreshToken: string }>();
      expect(body.refreshToken).toBeTypeOf('string');
      // Pas de cookies nexus_*
      const setCookie = res.headers['set-cookie'];
      expect(getCookie(setCookie, 'nexus_refresh')).toBeNull();
      expect(getCookie(setCookie, 'nexus_csrf')).toBeNull();
    });
  });

  // ----- PATCH /auth/me — préférences UI (theme + landing) -------------------
  // Cf. ADR-024 (#69) : on vérifie le défaut serveur, l'update et la
  // robustesse du Zod sur landingPreference.
  describe('PATCH /auth/me preferences', () => {
    async function registerAndGetTokens(email: string): Promise<{
      accessToken: string;
    }> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password: 'a-very-long-password',
          displayName: email.split('@')[0] ?? 'user',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ accessToken: string }>();
      return { accessToken: body.accessToken };
    }

    it("renvoie 'home' par défaut sur un user nouvellement créé", async () => {
      const { accessToken } = await registerAndGetTokens('pref-default@example.com');
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(me.statusCode).toBe(200);
      const body = me.json<{ user: { landingPreference: string } }>();
      expect(body.user.landingPreference).toBe('home');
    });

    it('met à jour landingPreference vers une valeur valide', async () => {
      const { accessToken } = await registerAndGetTokens('pref-update@example.com');
      const patch = await app.inject({
        method: 'PATCH',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { landingPreference: 'last_channel' },
      });
      expect(patch.statusCode).toBe(200);
      const body = patch.json<{ user: { landingPreference: string } }>();
      expect(body.user.landingPreference).toBe('last_channel');

      // Re-GET pour confirmer la persistance
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(me.json<{ user: { landingPreference: string } }>().user.landingPreference).toBe(
        'last_channel',
      );
    });

    it('rejette une valeur invalide pour landingPreference (Zod)', async () => {
      const { accessToken } = await registerAndGetTokens('pref-invalid@example.com');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { landingPreference: 'whatsapp' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('update partiel : changer themePreference ne touche pas landingPreference', async () => {
      const { accessToken } = await registerAndGetTokens('pref-partial@example.com');
      // 1. set landingPreference
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { landingPreference: 'last_group_first_channel' },
      });
      // 2. patch themePreference seul
      const patch = await app.inject({
        method: 'PATCH',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { themePreference: 'dark' },
      });
      expect(patch.statusCode).toBe(200);
      const body = patch.json<{
        user: { themePreference: string; landingPreference: string };
      }>();
      expect(body.user.themePreference).toBe('dark');
      expect(body.user.landingPreference).toBe('last_group_first_channel');
    });
  });

  // ----- POST /auth/forgot-password -------------------------------------------
  // Cf. MAN-171 phase 1 (sous-ticket MAN-166 « mot de passe oublié — reset
  // complet »). Réponse toujours { ok: true } pour ne jamais laisser deviner
  // si un email correspond à un compte — sauf panne serveur réelle (cf. le
  // dernier test de ce bloc).
  describe('POST /auth/forgot-password', () => {
    beforeEach(() => {
      sendPasswordResetEmailMock.mockReset();
      sendPasswordResetEmailMock.mockResolvedValue(undefined);
    });

    it('test_forgot_password_existing_email_creates_token_and_sends_email', async () => {
      const register = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'forgot-existing@example.com',
          password: 'a-very-long-password',
          displayName: 'ForgotExisting',
        },
      });
      expect(register.statusCode).toBe(200);
      const { user } = register.json<{ user: { id: string } }>();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'forgot-existing@example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      const { getDb } = await import('../../db/client.js');
      const { passwordResetTokens } = await import('../../db/schema/index.js');
      const rows = await getDb()
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.usedAt).toBeNull();

      expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(
        'forgot-existing@example.com',
        expect.stringContaining('/reset-password?token='),
      );
    });

    it('test_forgot_password_unknown_email_same_response_no_email_sent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'nobody-forgot@example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();

      const { getDb } = await import('../../db/client.js');
      const { users: usersTable } = await import('../../db/schema/index.js');
      const rows = await getDb()
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, 'nobody-forgot@example.com'));
      expect(rows).toHaveLength(0);
    });

    it('test_forgot_password_invalidates_previous_token', async () => {
      const register = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'forgot-twice@example.com',
          password: 'a-very-long-password',
          displayName: 'ForgotTwice',
        },
      });
      const { user } = register.json<{ user: { id: string } }>();

      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'forgot-twice@example.com' },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'forgot-twice@example.com' },
      });
      expect(second.statusCode).toBe(200);

      const { getDb } = await import('../../db/client.js');
      const { passwordResetTokens } = await import('../../db/schema/index.js');
      const rows = await getDb()
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(2);
    });

    /**
     * Non-régression de l'anti-énumération (revue de code MAN-171). La version
     * initiale laissait l'échec d'envoi remonter en 500 : comme un compte
     * INEXISTANT ne touche jamais Resend et répond toujours 200, l'écart
     * 500/200 devenait un oracle d'énumération parfait — déclenchable à
     * volonté par un attaquant (saturation du rate limit Resend), et actif en
     * permanence tant que `RESEND_API_KEY` n'est pas configurée. La réponse
     * doit être STRICTEMENT identique dans les deux cas, corps compris.
     */
    it('test_forgot_password_email_send_failure_does_not_leak_account_existence', async () => {
      const register = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'forgot-fail@example.com',
          password: 'a-very-long-password',
          displayName: 'ForgotFail',
        },
      });
      expect(register.statusCode).toBe(200);

      sendPasswordResetEmailMock.mockRejectedValueOnce(new Error('resend down'));

      // Compte EXISTANT dont l'envoi d'email échoue.
      const existing = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'forgot-fail@example.com' },
      });

      // Compte INEXISTANT (aucun envoi tenté).
      const unknown = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'forgot-fail-unknown@example.com' },
      });

      expect(existing.statusCode).toBe(200);
      expect(existing.json()).toEqual({ ok: true });
      // Indistinguables : c'est toute la propriété recherchée.
      expect(existing.statusCode).toBe(unknown.statusCode);
      expect(existing.body).toBe(unknown.body);
    });

    /**
     * Même propriété, cas le plus probable en prod : `RESEND_API_KEY` /
     * `EMAIL_FROM` absentes de l'env (elles sont `optional()` dans `loadEnv`,
     * et rien ne les pose aujourd'hui côté déploiement). Le vrai
     * `sendPasswordResetEmail` throw alors systématiquement.
     */
    it('test_forgot_password_email_not_configured_still_returns_ok', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'forgot-noconfig@example.com',
          password: 'a-very-long-password',
          displayName: 'ForgotNoConfig',
        },
      });

      const { AppError } = await import('../../core/errors.js');
      sendPasswordResetEmailMock.mockRejectedValue(new AppError('INTERNAL_ERROR'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'forgot-noconfig@example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("rejette un email invalide côté Zod avant d'atteindre le service", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'not-an-email' },
      });
      expect(res.statusCode).toBe(400);
      expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
    });
  });

  // ----- POST /auth/reset-password --------------------------------------------
  // Cf. MAN-171 phase 1 (sous-ticket MAN-166 « mot de passe oublié — reset
  // complet »). Consomme le jeton émis par /auth/forgot-password et applique
  // le nouveau mot de passe. Un seul code d'erreur pour l'instant
  // (AUTH_RESET_TOKEN_INVALID) — la distinction fine expiré/utilisé/inconnu
  // est hors scope (MAN-173).
  describe('POST /auth/reset-password', () => {
    beforeEach(() => {
      sendPasswordResetEmailMock.mockReset();
      sendPasswordResetEmailMock.mockResolvedValue(undefined);
    });

    /** Déclenche /forgot-password et récupère le jeton brut envoyé par email. */
    function extractRawToken(): string {
      const calls = sendPasswordResetEmailMock.mock.calls;
      const lastCall = calls[calls.length - 1] as [string, string] | undefined;
      const resetUrl = lastCall?.[1];
      const match = resetUrl ? /token=([^&]+)/.exec(resetUrl) : null;
      if (!match?.[1]) throw new Error('no reset token captured in mock');
      return match[1];
    }

    it('test_reset_password_valid_token_updates_password', async () => {
      const email = 'reset-valid@example.com';
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'a-very-long-password', displayName: 'ResetValid' },
      });

      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email },
      });
      const rawToken = extractRawToken();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token: rawToken, newPassword: 'a-brand-new-long-password' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      // Login avec l'ancien mot de passe échoue
      const oldLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'a-very-long-password' },
      });
      expect(oldLogin.statusCode).toBe(401);

      // Login avec le nouveau mot de passe réussit
      const newLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'a-brand-new-long-password' },
      });
      expect(newLogin.statusCode).toBe(200);
    });

    it('test_reset_password_marks_token_as_used', async () => {
      const email = 'reset-mark-used@example.com';
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'a-very-long-password', displayName: 'ResetMarkUsed' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email },
      });
      const rawToken = extractRawToken();

      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token: rawToken, newPassword: 'first-new-long-password' },
      });
      expect(first.statusCode).toBe(200);

      const { getDb } = await import('../../db/client.js');
      const { passwordResetTokens } = await import('../../db/schema/index.js');
      const { hashResetToken } = await import('./service.js');
      const tokenHash = hashResetToken(rawToken);
      const rows = await getDb()
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.usedAt).not.toBeNull();

      // Réutilisation immédiate du même jeton → rejeté
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token: rawToken, newPassword: 'second-new-long-password' },
      });
      expect(second.statusCode).toBe(400);
      const body = second.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');
    });

    /**
     * Non-régression : le reset EST le flow de récupération d'un compte
     * compromis (revue de code MAN-171, avancé depuis Phase 3/MAN-173). Un
     * refresh token émis avant le reset ne doit plus permettre de renouveler
     * l'access token après — sinon l'attaquant qui possédait déjà une
     * session survit à la "récupération" de la victime.
     */
    it('test_reset_password_revokes_existing_refresh_tokens', async () => {
      const email = 'reset-revokes-sessions@example.com';
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'a-very-long-password', displayName: 'ResetRevoke' },
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'a-very-long-password' },
      });
      const { refreshToken } = login.json<{ refreshToken: string }>();

      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email },
      });
      const rawToken = extractRawToken();
      const reset = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token: rawToken, newPassword: 'a-brand-new-long-password' },
      });
      expect(reset.statusCode).toBe(200);

      const refresh = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken },
      });
      expect(refresh.statusCode).toBe(401);
    });

    it('test_reset_password_already_used_token_rejected', async () => {
      const email = 'reset-already-used@example.com';
      const register = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'a-very-long-password', displayName: 'ResetAlreadyUsed' },
      });
      const { user } = register.json<{ user: { id: string } }>();

      const { getDb } = await import('../../db/client.js');
      const { passwordResetTokens } = await import('../../db/schema/index.js');
      const { hashResetToken } = await import('./service.js');
      const rawToken = 'already-used-raw-token';
      await getDb()
        .insert(passwordResetTokens)
        .values({
          userId: user.id,
          tokenHash: hashResetToken(rawToken),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          usedAt: new Date(),
        });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token: rawToken, newPassword: 'attempted-new-long-password' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');

      // Login avec l'ancien mot de passe fonctionne toujours (pas changé)
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'a-very-long-password' },
      });
      expect(login.statusCode).toBe(200);
    });

    it('test_reset_password_expired_token_rejected', async () => {
      const email = 'reset-expired@example.com';
      const register = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'a-very-long-password', displayName: 'ResetExpired' },
      });
      const { user } = register.json<{ user: { id: string } }>();

      const { getDb } = await import('../../db/client.js');
      const { passwordResetTokens } = await import('../../db/schema/index.js');
      const { hashResetToken } = await import('./service.js');
      const rawToken = 'expired-raw-token';
      await getDb()
        .insert(passwordResetTokens)
        .values({
          userId: user.id,
          tokenHash: hashResetToken(rawToken),
          expiresAt: new Date(Date.now() - 60 * 1000),
        });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token: rawToken, newPassword: 'attempted-new-long-password' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'a-very-long-password' },
      });
      expect(login.statusCode).toBe(200);
    });

    it('test_reset_password_unknown_token_rejected', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token: 'this-token-does-not-exist', newPassword: 'attempted-long-password' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');
    });

    /**
     * Non-régression du replay concurrent (revue de code MAN-171). La version
     * initiale validait le jeton par un SELECT hors transaction puis le
     * marquait `usedAt` inconditionnellement : deux requêtes simultanées
     * portant le MÊME jeton passaient toutes les deux la validation et
     * appliquaient toutes les deux leur mot de passe, le dernier écrivain
     * gagnant. Quiconque intercepte le lien (proxy mail, historique, Referer)
     * pouvait donc écraser le reset légitime et prendre le compte. Un seul
     * appel doit réussir.
     */
    it('test_reset_password_concurrent_replay_only_one_wins', async () => {
      const email = 'reset-race@example.com';
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'a-very-long-password', displayName: 'ResetRace' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email },
      });
      const rawToken = extractRawToken();

      const [a, b] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/reset-password',
          payload: { token: rawToken, newPassword: 'legit-user-new-long-password' },
        }),
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/reset-password',
          payload: { token: rawToken, newPassword: 'attacker-new-long-password' },
        }),
      ]);

      const statuses = [a.statusCode, b.statusCode].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 400]);

      // Et un seul des deux mots de passe est réellement actif.
      const logins = await Promise.all(
        ['legit-user-new-long-password', 'attacker-new-long-password'].map((password) =>
          app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } }),
        ),
      );
      expect(logins.filter((r) => r.statusCode === 200)).toHaveLength(1);
    });

    it('rejette un newPassword trop court côté Zod', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token: 'whatever', newPassword: 'short' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
