import { resetEnvCache } from '../core/env.js';

/**
 * Pose des variables d'env minimales pour les tests d'intégration backend.
 *
 * À appeler dans `beforeAll` (ou en global setup) avant `buildServer()`.
 * Les valeurs ici sont volontairement déterministes pour ne pas dépendre
 * d'un .env local.
 */
export function setTestEnv(): void {
  process.env['NODE_ENV'] = 'test';
  process.env['LOG_LEVEL'] = 'silent';
  process.env['BACKEND_PORT'] = '0';
  process.env['BACKEND_HOST'] = '127.0.0.1';

  // En J1a, on n'a pas encore de Postgres réel — l'URL est posée pour
  // satisfaire la validation Zod, le ping sera implémenté en J1b.
  process.env['DATABASE_URL'] ??= 'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';
  process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379/15';

  process.env['JWT_ACCESS_SECRET'] ??= 'a'.repeat(64);
  process.env['JWT_REFRESH_SECRET'] ??= 'b'.repeat(64);
  process.env['JWT_ACCESS_TTL'] = '15m';
  process.env['JWT_REFRESH_TTL'] = '30d';

  resetEnvCache();
}
