import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { loadEnv } from '../core/env.js';

import * as schema from './schema/index.js';

/**
 * Client Postgres + Drizzle Nexus.
 *
 * Une seule instance par process (Fastify principal ou worker).
 * Les tests créent leur propre client sur un schema isolé via `createDbClient`.
 */
let _sql: Sql | undefined;
let _db: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (_db) return _db;
  const env = loadEnv();
  _sql = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  _db = drizzle(_sql, { schema });
  return _db;
}

export function getSql(): Sql {
  if (!_sql) getDb();
  return _sql!;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = undefined;
    _db = undefined;
  }
}

/** Crée un client isolé (utilisé par les tests d'intégration). */
export function createDbClient(connectionString: string): {
  sql: Sql;
  db: PostgresJsDatabase<typeof schema>;
} {
  const sql = postgres(connectionString, { max: 5 });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

export { schema };
export type Database = PostgresJsDatabase<typeof schema>;
