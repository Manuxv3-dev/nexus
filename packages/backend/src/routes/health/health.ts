import { type HealthStatus, HealthStatusSchema } from '@nexus/shared';
import type { FastifyPluginAsync } from 'fastify';

import { pingPostgres, pingRedis } from '../../db/health.js';

const startedAt = Date.now();

/**
 * GET /api/v1/health — état du backend Nexus.
 *
 * Pings rapides de Postgres et Redis.
 */
// Contrat FastifyPluginAsync ; app.get(...) est un enregistrement synchrone.
// eslint-disable-next-line @typescript-eslint/require-await
export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/health', async () => {
    const [postgres, redis] = await Promise.all([pingPostgres(), pingRedis()]);

    const allOk = postgres === 'ok' && redis === 'ok';
    const anyDown = postgres === 'down' || redis === 'down';

    const payload: HealthStatus = {
      status: allOk ? 'ok' : anyDown ? 'down' : 'degraded',
      version: process.env['npm_package_version'] ?? '0.0.0',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
      dependencies: {
        postgres,
        redis,
      },
    };
    return HealthStatusSchema.parse(payload);
  });
};
