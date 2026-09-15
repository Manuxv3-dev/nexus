/**
 * Worker `push-send` (cf. ticket Cortex `505c6a76` — dette signalée en revue
 * de MAN-142 phase 1 push, reconfirmée en clôture de MAN-24 phase 5 MAN-146).
 *
 * Process séparé qui consomme la queue BullMQ `push-send` et déclenche le
 * fan-out d'envoi Web Push réel via `sendPushToUsers`. Sort l'envoi push du
 * chemin de la requête HTTP : le choke point d'insertion des notifications
 * (`insertNotification`/`insertNotificationsBulk`, cf.
 * `routes/notifications/repo.ts`) enqueue un job au lieu d'awaiter
 * directement l'envoi — un rappel à 50 members × 2 devices ne retarde donc
 * plus la réponse HTTP de jusqu'à ~10s (timeout par envoi, cf.
 * `PUSH_SEND_TIMEOUT_MS` dans `routes/push/repo.ts`).
 *
 * Pipeline d'un job :
 *  1. Reçoit `targets` déjà résolus par le producteur (aucune requête DB ici)
 *  2. Appelle `sendPushToUsers(targets)` — logique d'envoi, timeout et purge
 *     404/410 des souscriptions mortes INCHANGÉE (cf. `routes/push/repo.ts`)
 *  3. `sendPushToUsers` est déjà best-effort PAR SOUSCRIPTION en interne
 *     (chaque envoi individuel est try/catch, jamais relancé) : ce processor
 *     ne catch donc rien lui-même. Si `sendPushToUsers` throw malgré tout
 *     (ex: la requête `push_subscriptions` échoue, DB indisponible), on
 *     laisse l'erreur remonter à BullMQ pour bénéficier du retry
 *     (`attempts`/`backoff`, cf. `workers/queues.ts`) — un vrai gain vs
 *     l'ancien appel direct, qui n'avait aucun retry possible.
 *
 * Démarrage en dev :  `pnpm --filter @nexus/backend dev:worker:push`
 * Démarrage en prod : `pnpm --filter @nexus/backend start:worker:push`
 */
import { fileURLToPath } from 'node:url';

import '../bootstrap-env.js';

import { Worker, type Job } from 'bullmq';

import { logger } from '../core/logger.js';
import { sendPushToUsers } from '../routes/push/repo.js';

import { acquireLock, type BridgeLock } from './lock.js';
import { createQueueConnection, QUEUE_NAMES, type PushSendJobData } from './queues.js';

let bridgeLock: BridgeLock | undefined;
let worker: Worker<PushSendJobData> | undefined;

/**
 * Processor d'un job `push-send`. Exporté pour permettre les tests
 * unitaires sans avoir à monter une vraie instance BullMQ.
 */
export async function processPushSendJob(job: Job<PushSendJobData>): Promise<void> {
  const { targets } = job.data;
  const log = logger.child({ worker: 'push-send', jobId: job.id, count: targets.length });

  await sendPushToUsers(targets);

  log.debug('push job processed');
}

async function main(): Promise<void> {
  logger.info({ worker: 'push-send' }, 'starting');

  // Lock distribué — un seul worker push-send par cluster (anti-doublon,
  // même pattern que event-reminders/notifications-purge).
  bridgeLock = await acquireLock('lock:worker:push-send');
  logger.info({ worker: 'push-send' }, 'lock acquired');

  worker = new Worker<PushSendJobData>(QUEUE_NAMES.PUSH_SEND, processPushSendJob, {
    connection: createQueueConnection(),
    // Petite concurrence : le fan-out par device est déjà géré en interne par
    // `sendPushToUsers` (Promise.all sur les souscriptions d'un lot).
    concurrency: 5,
  });

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

  logger.info({ worker: 'push-send' }, 'ready');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ worker: 'push-send', signal }, 'shutting down');
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

/**
 * Bootstrap garde : n'exécute `main()` que si ce module est lancé
 * directement (pas importé par un test). Permet d'importer
 * `processPushSendJob` depuis les tests sans démarrer le worker.
 */
const isMainModule =
  process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  main().catch((err) => {
    logger.fatal({ err }, 'push-send worker failed to start');
    process.exit(1);
  });
}
