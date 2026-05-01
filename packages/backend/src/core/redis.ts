/**
 * Client Redis partagé.
 *
 * Pattern singleton lazy : on ouvre la connexion à la première utilisation,
 * on la réutilise ensuite. Réservé aux opérations **non-pub/sub** (cache,
 * GET/SET, EXPIRE, etc.). Pour pub/sub, ouvrir un client dédié — un même
 * client ne peut pas être à la fois subscriber ET publisher (cf. limitation
 * Redis pub/sub).
 *
 * Usage :
 *   import { getRedis } from '../core/redis.js';
 *   const redis = getRedis();
 *   await redis.set('foo', 'bar', 'EX', 60);
 */
import Redis from 'ioredis';

import { loadEnv } from './env.js';

let _shared: Redis | undefined;

/**
 * Renvoie le client Redis partagé. Idempotent — la connexion n'est ouverte
 * qu'à la première utilisation.
 */
export function getRedis(): Redis {
  if (_shared) return _shared;
  const env = loadEnv();
  _shared = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  return _shared;
}

/**
 * Ferme proprement le client partagé (utile pour les tests / shutdown).
 */
export async function closeSharedRedis(): Promise<void> {
  if (!_shared) return;
  await _shared.quit().catch(() => _shared?.disconnect());
  _shared = undefined;
}
