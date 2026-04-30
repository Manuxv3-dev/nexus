/**
 * @nexus/backend — entrypoint placeholder.
 *
 * À J0 (Fondations), on prouve juste que :
 *   - le typecheck passe end-to-end
 *   - on peut importer @nexus/shared sans drama
 *   - vitest tourne
 *
 * L'API Fastify, l'auth, les bridges, etc. arrivent en J1+.
 */
import { type HealthStatus, HealthStatusSchema } from '@nexus/shared';

/**
 * Renvoie un statut placeholder. Sera remplacé en J1 par un vrai healthcheck
 * (ping Postgres + Redis).
 */
export function buildPlaceholderHealth(): HealthStatus {
  return HealthStatusSchema.parse({
    status: 'ok',
    version: '0.0.0',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: {
      postgres: 'unknown',
      redis: 'unknown',
    },
  });
}
