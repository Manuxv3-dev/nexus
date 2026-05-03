/**
 * Worker `event-reminders` (cf. ADR-020, J5b #42).
 *
 * Process séparé qui consomme la queue BullMQ `event-reminders` et émet
 * un WS event `event:reminder` aux members concernés du groupe à T-24h
 * et T-1h du début d'un event.
 *
 * Pipeline d'un job :
 *  1. Re-load l'event en DB (via `getEventById`)
 *  2. Si event introuvable (supprimé entre temps) → no-op silencieux
 *  3. Si `startsAt` est dans le passé (avec tolérance 5 min) → no-op
 *     (le job a été décalé par BullMQ ou retry après un downtime worker)
 *  4. Récupère les members du group (`listMembers`)
 *  5. Filtre l'audience : exclut les RSVP=`no`
 *  6. Si `userIds` vide → no-op
 *  7. Publie `event:reminder` via `publishNexusEvent` → relayé aux WS
 *     clients par `nexus-relay`
 *
 * Démarrage en dev :  `pnpm --filter @nexus/backend dev:worker:reminders`
 * Démarrage en prod : `pnpm --filter @nexus/backend start:worker:reminders`
 */
import { fileURLToPath } from 'node:url';

import '../bootstrap-env.js';

import { Worker, type Job } from 'bullmq';

import { logger } from '../core/logger.js';
import { getEventById } from '../routes/events/repo.js';
import { listMembers } from '../routes/groups/service.js';
import { insertNotificationsBulk } from '../routes/notifications/repo.js';
import { publishNexusEvent } from '../ws/nexus-event-bus.js';

import { acquireLock, type BridgeLock } from './lock.js';
import {
  createQueueConnection,
  QUEUE_NAMES,
  type EventReminderJobData,
} from './queues.js';

/**
 * Tolérance en ms : si `startsAt` est dans le passé de moins de TOLERANCE_MS,
 * le job est tout de même tiré (utile si le worker a redémarré et tire un job
 * en retard de quelques minutes). Au-delà, on considère le rappel comme
 * périmé et on no-op.
 */
const TOLERANCE_MS = 5 * 60 * 1000;

let bridgeLock: BridgeLock | undefined;
let worker: Worker<EventReminderJobData> | undefined;

/**
 * Processor d'un job `event-reminders`. Exporté pour permettre les tests
 * unitaires sans avoir à monter une vraie instance BullMQ.
 */
export async function processEventReminderJob(
  job: Job<EventReminderJobData>,
): Promise<void> {
  const { eventId, tier } = job.data;
  const log = logger.child({ worker: 'event-reminders', eventId, tier, jobId: job.id });

  const event = await getEventById(eventId);
  if (!event) {
    log.debug('event not found (likely deleted) — skipping');
    return;
  }

  const startsAtMs = event.startsAt.getTime();
  const now = Date.now();
  if (startsAtMs < now - TOLERANCE_MS) {
    log.debug(
      { startsAtMs, now, lateBy: now - startsAtMs },
      'event already past tolerance window — skipping',
    );
    return;
  }

  // Audience : tous les members du group sauf RSVP=`no`.
  const members = await listMembers(event.groupId);
  const noUserIds = new Set(
    event.rsvps.filter((r) => r.value === 'no').map((r) => r.userId),
  );
  const userIds = members
    .map((m) => m.user.id)
    .filter((uid) => !noUserIds.has(uid));

  if (userIds.length === 0) {
    log.debug('no users to notify (all RSVP=no or empty group) — skipping');
    return;
  }

  await publishNexusEvent({
    type: 'event:reminder',
    groupId: event.groupId,
    timestamp: Date.now(),
    payload: { eventId: event.id, tier, userIds },
  });

  // Persiste 1 notif par user concerné (cf. ADR-023). Best-effort.
  try {
    const notifs = await insertNotificationsBulk(
      userIds.map((uid) => ({
        userId: uid,
        kind: 'event_reminder' as const,
        payload: {
          eventId: event.id,
          eventTitle: event.title,
          tier,
          startsAt: event.startsAt.toISOString(),
        },
        groupId: event.groupId,
        sourceId: event.id,
      })),
    );
    for (const n of notifs) {
      await publishNexusEvent({
        type: 'notification:created',
        groupId: event.groupId,
        timestamp: Date.now(),
        payload: { notificationId: n.id, userId: n.userId, kind: 'event_reminder' },
      });
    }
  } catch (err) {
    log.warn({ err }, 'failed to persist event_reminder notifications');
  }

  log.info({ recipients: userIds.length }, 'reminder fired');
}

async function main(): Promise<void> {
  logger.info({ worker: 'event-reminders' }, 'starting');

  // Lock distribué — un seul worker reminders par cluster (anti-doublon)
  bridgeLock = await acquireLock('lock:worker:event-reminders');
  logger.info({ worker: 'event-reminders' }, 'lock acquired');

  worker = new Worker<EventReminderJobData>(
    QUEUE_NAMES.EVENT_REMINDERS,
    processEventReminderJob,
    {
      connection: createQueueConnection(),
      concurrency: 5,
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

  logger.info({ worker: 'event-reminders' }, 'ready');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ worker: 'event-reminders', signal }, 'shutting down');
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
 * `processEventReminderJob` depuis les tests sans démarrer le worker.
 */
const isMainModule =
  process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  main().catch((err) => {
    logger.fatal({ err }, 'event-reminders worker failed to start');
    process.exit(1);
  });
}
