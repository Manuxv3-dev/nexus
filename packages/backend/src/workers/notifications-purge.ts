/**
 * Worker `notifications-purge` (cf. ADR-023 lot C4).
 *
 * Process séparé qui supprime les notifs > 30 jours via un job recurring
 * BullMQ (cron 1×/jour à 3h UTC, période creuse).
 *
 * Pipeline :
 *  1. Acquiert un lock distribué (anti-doublon multi-replica)
 *  2. Au démarrage, upsert le job recurring (idempotent — schedulerId déterministe)
 *  3. Worker BullMQ consomme : appelle `purgeOldNotifications(N)` du repo
 *     avec N par défaut = 30 (override possible via job.data.olderThanDays).
 *  4. Log le nombre de lignes supprimées.
 *
 * Démarrage en dev :  `pnpm --filter @nexus/backend dev:worker:purge`
 * Démarrage en prod : `pnpm --filter @nexus/backend start:worker:purge`
 *
 * Implications ops VPS (cf. ADR-012) : nouveau service systemd
 * `nexus-worker-purge-notifications.service` à provisionner. Très léger
 * (~50 Mo RAM, 1 query/nuit).
 */
import { fileURLToPath } from 'node:url';

import '../bootstrap-env.js';

import { Worker, type Job } from 'bullmq';

import { logger } from '../core/logger.js';
import { purgeOldNotifications } from '../routes/notifications/repo.js';

import { acquireLock, type BridgeLock } from './lock.js';
import {
  createQueueConnection,
  getNotificationsPurgeQueue,
  QUEUE_NAMES,
  type NotificationsPurgeJobData,
} from './queues.js';

/** Rétention par défaut. Override possible via job.data.olderThanDays. */
const DEFAULT_RETENTION_DAYS = 30;

/** Cron pattern : tous les jours à 3:00 UTC (creux de trafic). */
const CRON_PATTERN = '0 3 * * *';

/** SchedulerId déterministe → idempotence à chaque démarrage du worker. */
const SCHEDULER_ID = 'notifications-purge:daily';

let bridgeLock: BridgeLock | undefined;
let worker: Worker<NotificationsPurgeJobData> | undefined;

/**
 * Processor d'un job. Exporté pour permettre les tests unitaires.
 */
export async function processNotificationsPurgeJob(
  job: Job<NotificationsPurgeJobData>,
): Promise<{ deleted: number }> {
  const olderThanDays = job.data.olderThanDays ?? DEFAULT_RETENTION_DAYS;
  const log = logger.child({
    worker: 'notifications-purge',
    jobId: job.id,
    olderThanDays,
  });

  log.info('purge starting');
  const deleted = await purgeOldNotifications(olderThanDays);
  log.info({ deleted }, 'purge done');
  return { deleted };
}

async function main(): Promise<void> {
  logger.info({ worker: 'notifications-purge' }, 'starting');

  // Lock distribué — un seul worker purge par cluster (anti-doublon).
  bridgeLock = await acquireLock('lock:worker:notifications-purge');
  logger.info({ worker: 'notifications-purge' }, 'lock acquired');

  // Schedule le job recurring. `upsertJobScheduler` est idempotent : si
  // un scheduler avec le même ID existe déjà, BullMQ met juste à jour son
  // pattern. Pas besoin de check-then-add.
  const queue = getNotificationsPurgeQueue();
  await queue.upsertJobScheduler(
    SCHEDULER_ID,
    { pattern: CRON_PATTERN, tz: 'UTC' },
    {
      name: 'purge',
      data: {} as NotificationsPurgeJobData,
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 30 },
        removeOnFail: { age: 30 * 24 * 3600, count: 30 },
      },
    },
  );
  logger.info(
    { schedulerId: SCHEDULER_ID, pattern: CRON_PATTERN },
    'recurring job scheduled',
  );

  worker = new Worker<NotificationsPurgeJobData>(
    QUEUE_NAMES.NOTIFICATIONS_PURGE,
    processNotificationsPurgeJob,
    {
      connection: createQueueConnection(),
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, name: job.name }, 'job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, name: job?.name, attemptsMade: job?.attemptsMade, err },
      'job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'worker error');
  });

  logger.info({ worker: 'notifications-purge' }, 'ready');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ worker: 'notifications-purge', signal }, 'shutting down');
  if (worker) {
    try {
      await worker.close();
    } catch (err) {
      logger.error({ err }, 'failed to close worker');
    }
  }
  if (bridgeLock) {
    try {
      await bridgeLock.release();
    } catch (err) {
      logger.error({ err }, 'failed to release lock');
    }
  }
  process.exit(0);
}

const isMainModule =
  process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  main().catch((err) => {
    logger.fatal({ err }, 'notifications-purge worker failed to start');
    process.exit(1);
  });
}
