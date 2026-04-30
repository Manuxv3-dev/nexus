import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv } from '../../test/helpers.js';

import type { FastifyInstance } from 'fastify';

describe('GET /api/v1/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    setTestEnv();
    const { buildServer } = await import('../../server.js');
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import('../../db/client.js');
    const { closeRedis } = await import('../../db/health.js');
    await closeDb();
    await closeRedis();
  });

  it('renvoie un statut conforme au schéma partagé', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as Record<string, unknown>;
    expect(body['status']).toMatch(/^(ok|degraded|down)$/);
    expect(body['version']).toBeTypeOf('string');
    expect(body['uptimeSeconds']).toBeGreaterThanOrEqual(0);
    expect(body['dependencies']).toMatchObject({
      postgres: expect.stringMatching(/^(ok|degraded|down|unknown)$/) as unknown,
      redis: expect.stringMatching(/^(ok|degraded|down|unknown)$/) as unknown,
    });
  });

  it('inclut un requestId dans les erreurs 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);

    const body = res.json() as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.error.requestId).toMatch(/^req_/);
  });
});
