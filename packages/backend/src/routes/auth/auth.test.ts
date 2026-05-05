import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv } from '../../test/helpers.js';
import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';

import type { FastifyInstance } from 'fastify';

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
    // eslint-disable-next-line no-console
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
      const body = res.json() as {
        user: { id: string; email: string };
        accessToken: string;
        refreshToken: string;
      };
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
      const body = res.json() as { error: { code: string } };
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
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('refuse un email inconnu (AUTH_INVALID_CREDENTIALS, pas leak)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@example.com', password: 'whatever-long-password' },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  describe('POST /auth/refresh — rotation et détection de réutilisation', () => {
    it('échange un refresh contre un nouveau couple, et révoque l\'ancien', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'manu@example.com', password: 'a-very-long-password' },
      });
      const original = login.json() as { refreshToken: string };

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
      const reuseBody = reuse.json() as { error: { code: string } };
      expect(reuseBody.error.code).toBe('AUTH_REFRESH_REUSED');

      // Le nouveau refresh est lui aussi maintenant révoqué (revoke all chain)
      const newToken = (refresh1.json() as { refreshToken: string }).refreshToken;
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
      const { accessToken } = login.json() as { accessToken: string };

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { user: { email: string } };
      expect(body.user.email).toBe('manu@example.com');
    });
  });

  describe('auth — mode web (cookie + CSRF, ADR-015)', () => {
    /**
     * Helper : extrait la valeur d'un cookie depuis Set-Cookie array.
     * Cookie format: "name=value; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=..."
     */
    function getCookie(setCookieHeader: string | string[] | undefined, name: string): string | null {
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

    it('register en mode web pose les cookies et n\'inclut pas refreshToken dans le body', async () => {
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

      const body = res.json() as { accessToken: string; refreshToken?: string };
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
      const body = res.json() as { refreshToken?: string };
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
      const body = res.json() as { accessToken: string; refreshToken?: string };
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
      const body = res.json() as { error: { code: string } };
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
      const body = res.json() as { error: { code: string } };
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
      const body = res.json() as { error: { code: string } };
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
      const { accessToken } = reg.json() as { accessToken: string };

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
      const body = res.json() as { accessToken: string; refreshToken: string };
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
      const body = res.json() as { accessToken: string };
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
      const body = me.json() as { user: { landingPreference: string } };
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
      const body = patch.json() as { user: { landingPreference: string } };
      expect(body.user.landingPreference).toBe('last_channel');

      // Re-GET pour confirmer la persistance
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect((me.json() as { user: { landingPreference: string } }).user.landingPreference).toBe(
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

    it("update partiel : changer themePreference ne touche pas landingPreference", async () => {
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
      const body = patch.json() as {
        user: { themePreference: string; landingPreference: string };
      };
      expect(body.user.themePreference).toBe('dark');
      expect(body.user.landingPreference).toBe('last_group_first_channel');
    });
  });
});
