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
    await app.close();
    const { closeDb } = await import('../../db/client.js');
    const { closeRedis } = await import('../../db/health.js');
    await closeDb();
    await closeRedis();
    await testDb.cleanup();
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
});
