import Redis from 'ioredis';

import { loadEnv } from "../core/env.js";

/**
 * Lock distribué Redis simple (cf. ADR-009 — workers BullMQ singleton).
 *
 * Pattern :
 *  - SET <key> <value> NX PX <ttl_ms>  → acquire si absent, expire après TTL
 *  - DEL <key>                          → release
 *  - Refresh périodique (PEXPIRE)       → renouvelle le lease tant qu'on tient
 *
 * On utilise une `value` random unique pour pouvoir prouver qu'on tient
 * le lock au moment du release/refresh (sinon un autre worker pourrait
 * accidentellement libérer le nôtre si on a expiré entre temps).
 *
 * **Limitation connue** : ce lock n'est PAS un Redlock. En cas de failover
 * Redis (master → replica), il y a une fenêtre où deux workers pourraient
 * tenir le lock simultanément. Acceptable pour MVP (Redis simple, pas de
 * cluster). Si besoin → switch vers `node-redlock` plus tard.
 */

const LOCK_TTL_MS = 60_000; // 60 s
const REFRESH_INTERVAL_MS = 30_000; // 30 s

export interface BridgeLock {
  release: () => Promise<void>;
}

/**
 * Tente d'acquérir le lock. Bloque indéfiniment (poll 5s) jusqu'à
 * disponibilité. Renvoie un objet avec `release()` pour libérer
 * proprement.
 *
 * Le refresh est automatique tant que le process tourne. Sur SIGTERM,
 * le caller doit invoquer `release()` puis exit.
 */
export async function acquireLock(key: string): Promise<BridgeLock> {
  const redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  const value = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Acquire avec polling
  while (true) {
    const ok = await redis.set(key, value, 'PX', LOCK_TTL_MS, 'NX');
    if (ok === 'OK') break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Refresh périodique tant que la value matche (preuve qu'on tient le lock)
  const refreshScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    end
    return 0
  `;

  const refreshTimer = setInterval(() => {
    redis
      .eval(refreshScript, 1, key, value, LOCK_TTL_MS.toString())
      .catch(() => {
        // Si Redis est down, on laisse tomber — le lock expirera naturellement
      });
  }, REFRESH_INTERVAL_MS);

  refreshTimer.unref(); // Ne pas garder le process en vie pour ce timer

  return {
    release: async () => {
      clearInterval(refreshTimer);
      // Release seulement si on tient encore le lock (value match)
      const releaseScript = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
      `;
      try {
        await redis.eval(releaseScript, 1, key, value);
      } finally {
        await redis.quit();
      }
    },
  };
}
