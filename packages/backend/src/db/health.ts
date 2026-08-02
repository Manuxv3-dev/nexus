import { sql } from 'drizzle-orm';
import Redis from 'ioredis';

import { loadEnv } from '../core/env.js';

import { getDb } from './client.js';

export type DependencyStatus = 'ok' | 'degraded' | 'down' | 'unknown';

/**
 * Pings rapides des dépendances critiques (Postgres + Redis) pour le
 * healthcheck. Timeout court (~ 1s) pour ne pas bloquer la réponse.
 */
export async function pingPostgres(): Promise<DependencyStatus> {
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    return 'ok';
  } catch {
    return 'down';
  }
}

let _redis: Redis | undefined;

function getRedis(): Redis {
  if (_redis) return _redis;
  const env = loadEnv();
  _redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  return _redis;
}

export async function pingRedis(): Promise<DependencyStatus> {
  try {
    const r = getRedis();
    if (r.status === 'wait' || r.status === 'end') {
      await r.connect();
    }
    const reply = await r.ping();
    return reply === 'PONG' ? 'ok' : 'degraded';
  } catch {
    return 'down';
  }
}

// Async par symétrie avec closeDb (client.ts), toutes deux awaited ensemble
// dans les tests ; ioredis .disconnect() est volontairement synchrone
// (fermeture forcée, contrairement à .quit() qui est gracieux et async).
// eslint-disable-next-line @typescript-eslint/require-await
export async function closeRedis(): Promise<void> {
  if (_redis) {
    _redis.disconnect();
    _redis = undefined;
  }
}
