/**
 * Queues BullMQ — factories singleton (cf. ADR-020, J5b #42).
 *
 * Pattern :
 *  - Une fonction `getXxxQueue()` par queue, lazy + singleton.
 *  - La connexion ioredis utilisée par BullMQ est **dédiée** (pas le client
 *    `getRedis()` partagé) : BullMQ exige `maxRetriesPerRequest: null` sur
 *    les connexions de bclient/blocking, sinon il warn à chaque démarrage.
 *  - On expose aussi `closeAllQueues()` pour les tests / shutdown propre.
 *
 * Ajout d'une nouvelle queue :
 *  1. Définir une `QueueName` constante (string union dans `@nexus/shared`
 *     si la queue est consommée par un autre process).
 *  2. Créer une factory `getXxxQueue()` qui réutilise `createQueueConnection()`.
 *  3. Documenter la shape du job (input du processor) dans le worker associé.
 */
import { Queue, type ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';

import { loadEnv } from '../core/env.js';

/**
 * Noms de queues. Source de vérité partagée entre le scheduler (HTTP) et
 * le worker (process séparé). Valeur = `bull:<name>` côté Redis (préfixe
 * BullMQ par défaut), donc on garde des noms courts et stables.
 */
export const QUEUE_NAMES = {
  EVENT_REMINDERS: 'event-reminders',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Shape des jobs `event-reminders`.
 *
 * Convention `jobId` : `event-reminder:{eventId}:{tier}` — déterministe pour
 * permettre un re-schedule idempotent (cf. `services/event-reminders.ts`).
 */
export interface EventReminderJobData {
  eventId: string;
  tier: 'h24' | 'h1';
}

/**
 * Crée une connexion ioredis adaptée aux exigences BullMQ.
 *
 * BullMQ utilise des commandes bloquantes (BRPOPLPUSH, etc.) sur ses
 * connexions internes. Avec `maxRetriesPerRequest: 3`, ioredis kill la
 * commande après les retries → faux positifs. La doc BullMQ exige donc
 * `maxRetriesPerRequest: null` (cf. https://docs.bullmq.io/guide/connections).
 */
export function createQueueConnection(): Redis {
  return new Redis(loadEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

const queues = new Map<QueueName, Queue>();
const connections: Redis[] = [];

/**
 * Renvoie (ou crée) la queue BullMQ correspondant à `name`. Singleton lazy.
 */
function getQueue<TData>(name: QueueName): Queue<TData> {
  const existing = queues.get(name);
  if (existing) return existing as Queue<TData>;

  const connection: ConnectionOptions = createQueueConnection();
  // On garde la référence pour pouvoir close proprement plus tard.
  if (connection instanceof Redis) connections.push(connection);

  const q = new Queue<TData>(name, {
    connection,
    defaultJobOptions: {
      // Les rappels sont idempotents et best-effort : si la prod foire,
      // on retry 3x avec backoff exponentiel.
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      // Limite la taille des historiques BullMQ pour ne pas saturer Redis.
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
    },
  });
  queues.set(name, q);
  return q;
}

/**
 * Queue `event-reminders` — orchestre les jobs T-24h / T-1h des events.
 *
 * Producteur : routes Fastify `events` (POST/PATCH/DELETE) via
 * `services/event-reminders.ts`.
 * Consommateur : worker `workers/event-reminders.ts`.
 */
export function getEventRemindersQueue(): Queue<EventReminderJobData> {
  return getQueue<EventReminderJobData>(QUEUE_NAMES.EVENT_REMINDERS);
}

/**
 * Ferme toutes les queues + connexions ioredis associées. À utiliser dans
 * les tests et au shutdown du process pour ne pas leaker de handles.
 */
export async function closeAllQueues(): Promise<void> {
  for (const q of queues.values()) {
    try {
      await q.close();
    } catch {
      // best-effort
    }
  }
  queues.clear();
  for (const c of connections) {
    try {
      c.disconnect();
    } catch {
      // best-effort
    }
  }
  connections.length = 0;
}
