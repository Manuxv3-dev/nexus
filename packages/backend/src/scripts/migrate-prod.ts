/**
 * @nexus/backend — wrapper migrations production avec advisory lock.
 *
 * Cf. ADR-013 — Migrations DB en prod (stratégie expand/contract).
 *
 * Acquiert un Postgres advisory lock avant d'appliquer les migrations
 * Drizzle. Si un autre deploy tourne en parallèle (race condition rare
 * mais possible), il bloque jusqu'à libération.
 *
 * À exécuter via le script `db:migrate:prod` du backend, dans un
 * container one-shot lancé par `infra/deploy.sh` avant le swap du
 * backend principal.
 */
import '../bootstrap-env.js';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { loadEnv } from '../core/env.js';
import { logger } from '../core/logger.js';

/**
 * Magic number constant — voir ADR-013. Doit être identique à toute
 * future utilisation de pg_advisory_lock pour le mutex de migrations.
 */
const ADVISORY_LOCK_KEY = 871234567;

const MIGRATIONS_FOLDER = './drizzle/migrations';

async function main(): Promise<void> {
  const env = loadEnv();
  const sql = postgres(env.DATABASE_URL, {
    max: 1,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  const db = drizzle(sql);

  let locked = false;
  try {
    logger.info({ lockKey: ADVISORY_LOCK_KEY }, '[migrate-prod] Acquiring advisory lock');
    await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;
    locked = true;
    logger.info('[migrate-prod] Lock acquired, applying migrations');

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    logger.info('[migrate-prod] Migrations applied successfully');
  } catch (err) {
    logger.fatal({ err }, '[migrate-prod] Migration failed');
    process.exitCode = 1;
  } finally {
    if (locked) {
      try {
        await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
        logger.info('[migrate-prod] Lock released');
      } catch (err) {
        logger.error({ err }, '[migrate-prod] Failed to release advisory lock');
      }
    }
    await sql.end({ timeout: 5 });
  }
}

void main();
