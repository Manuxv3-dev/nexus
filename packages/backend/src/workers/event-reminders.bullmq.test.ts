/**
 * Test d'intégration bout-en-bout du pipeline BullMQ `event-reminders` (cf.
 * MAN-17, item "Timing des rappels d'événement").
 *
 * `event-reminders.test.ts` et `routes/events/scheduler.test.ts` mockent
 * entièrement `bullmq`/`workers/queues.js` : ils prouvent la logique
 * (calcul de délai, filtrage d'audience) mais jamais que Redis + BullMQ
 * livrent effectivement un job différé à un `Worker` réel. Ce fichier
 * couvre ce trou : vrai Redis, vraie `Queue`, vrai `Worker`, vrai
 * `processEventReminderJob` — avec un délai de quelques centaines de ms au
 * lieu de 24h/1h pour rester rapide. Vérifie aussi le push WS (via le vrai
 * bus pub/sub `nexus-event-bus`), pas seulement l'écriture DB.
 *
 * Isolation Redis : `REDIS_URL` est forcé (pas `??=`) sur la DB 15 dédiée
 * aux tests — sans ça, un `REDIS_URL` déjà posé par l'environnement (CI :
 * DB 0 ; dotenv local : DB 0 aussi) ferait courir ce test sur la même DB
 * qu'un worker `event-reminders` de dev qui tournerait en parallèle, avec
 * risque de double-traitement et de jobs résiduels d'un run précédent.
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB), comme les
 * autres tests d'intégration backend.
 */
import { randomUUID } from 'node:crypto';

import type { WsEvent } from '@nexus/shared';
import type { Worker as WorkerClass, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { getDb as GetDbFn } from '../db/client.js';
import type { users as UsersTable } from '../db/schema/index.js';
import type { createEvent as CreateEventFn } from '../routes/events/repo.js';
import type { createGroupForUser as CreateGroupForUserFn } from '../routes/groups/service.js';
import type { listNotificationsForUser as ListNotificationsForUserFn } from '../routes/notifications/repo.js';
import { isPostgresAvailable, setupTestDb, type TestDb } from '../test/db.js';
import { setTestEnv } from '../test/helpers.js';
import type { closeNexusBus as CloseNexusBusFn } from '../ws/nexus-event-bus.js';

import type { processEventReminderJob as ProcessEventReminderJobFn } from './event-reminders.js';
import type {
  closeAllQueues as CloseAllQueuesFn,
  createQueueConnection as CreateQueueConnectionFn,
  getEventRemindersQueue as GetEventRemindersQueueFn,
  QUEUE_NAMES as QueueNamesConst,
} from './queues.js';

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';
const TEST_REDIS_URL = process.env['REDIS_URL_TEST'] ?? 'redis://127.0.0.1:6379/15';

const TIERS = ['h24', 'h1'] as const;

describe('pipeline BullMQ event-reminders (Redis + Worker réels)', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping event-reminders BullMQ integration test');
    return;
  }

  let testDb: TestDb;
  let processEventReminderJob: typeof ProcessEventReminderJobFn;
  let getEventRemindersQueue: typeof GetEventRemindersQueueFn;
  let createQueueConnection: typeof CreateQueueConnectionFn;
  let closeAllQueues: typeof CloseAllQueuesFn;
  let QUEUE_NAMES: typeof QueueNamesConst;
  let createEvent: typeof CreateEventFn;
  let createGroupForUser: typeof CreateGroupForUserFn;
  let listNotificationsForUser: typeof ListNotificationsForUserFn;
  let getDb: typeof GetDbFn;
  let usersTable: typeof UsersTable;
  let Worker: typeof WorkerClass;
  let closeNexusBus: typeof CloseNexusBusFn;

  // `subscribeNexusEvents` est un singleton idempotent (1 seul handler actif
  // par process, cf. nexus-event-bus.ts) — on souscrit UNE fois dans
  // beforeAll vers ce buffer partagé, et chaque test filtre dessus par
  // groupId plutôt que de re-souscrire (le 2e appel serait un no-op silencieux).
  const allPublished: WsEvent[] = [];

  beforeAll(async () => {
    testDb = await setupTestDb(BASE_DB_URL);
    setTestEnv();
    process.env['DATABASE_URL'] = testDb.url;
    // Assignation forcée : `setTestEnv()` fait `??=`, donc un REDIS_URL déjà
    // posé (CI, dotenv local) gagnerait sinon — cf. commentaire d'en-tête.
    process.env['REDIS_URL'] = TEST_REDIS_URL;
    const { resetEnvCache } = await import('../core/env.js');
    resetEnvCache();

    ({ Worker } = await import('bullmq'));
    ({ processEventReminderJob } = await import('./event-reminders.js'));
    ({ getEventRemindersQueue, createQueueConnection, closeAllQueues, QUEUE_NAMES } =
      await import('./queues.js'));
    ({ createEvent } = await import('../routes/events/repo.js'));
    ({ createGroupForUser } = await import('../routes/groups/service.js'));
    ({ listNotificationsForUser } = await import('../routes/notifications/repo.js'));
    ({ getDb } = await import('../db/client.js'));
    ({ users: usersTable } = await import('../db/schema/index.js'));
    const { subscribeNexusEvents, closeNexusBus: close } = await import('../ws/nexus-event-bus.js');
    closeNexusBus = close;
    await subscribeNexusEvents((evt) => {
      allPublished.push(evt);
    });

    // Drain les jobs résiduels d'un run précédent avant de commencer.
    await getEventRemindersQueue().obliterate({ force: true });
  });

  afterAll(async () => {
    if (closeAllQueues) await closeAllQueues();
    if (closeNexusBus) await closeNexusBus();
    if (testDb) await testDb.cleanup();
  });

  it.each(TIERS)(
    'un job "%s" enqueued avec délai est réellement traité par un Worker : notif DB + push WS',
    async (tier) => {
      const db = getDb();
      const [user] = await db
        .insert(usersTable)
        .values({
          email: `bullmq-e2e+${randomUUID()}@nexus-test.local`,
          passwordHash: 'unused',
          displayName: 'BullMQ E2E',
        })
        .returning();
      if (!user) throw new Error('seed user failed');

      const { group } = await createGroupForUser(user.id, { name: `BullMQ E2E ${tier}` });
      const event = await createEvent({
        groupId: group.id,
        title: `BullMQ E2E event ${tier}`,
        startsAt: new Date(Date.now() + 60 * 60 * 1000), // +1h, largement dans la tolérance
        createdBy: user.id,
      });

      // Worker réel, pointé sur la même queue/connection que la prod — seul
      // le délai (quelques centaines de ms au lieu de 24h/1h) diffère.
      let ownConnection: Redis | undefined;
      const worker = new Worker(QUEUE_NAMES.EVENT_REMINDERS, processEventReminderJob, {
        connection: (ownConnection = createQueueConnection()),
        concurrency: 1,
      });

      try {
        const completed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Timeout : le worker n’a pas traité le job à temps')),
            8000,
          );
          worker.on('completed', (job: Job) => {
            if (job.data.eventId === event.id) {
              clearTimeout(timer);
              resolve();
            }
          });
          worker.on('failed', (job: Job | undefined, err: Error) => {
            if (job?.data.eventId === event.id) {
              clearTimeout(timer);
              reject(err);
            }
          });
        });

        await getEventRemindersQueue().add(
          'event-reminder',
          { eventId: event.id, tier },
          {
            delay: 300,
          },
        );

        await completed;

        const { notifications } = await listNotificationsForUser(user.id, {});
        expect(notifications).toHaveLength(1);
        expect(notifications[0]).toMatchObject({
          userId: user.id,
          kind: 'event_reminder',
          sourceId: event.id,
        });

        // Push WS réel : `event:reminder` (audience) + `notification:created`
        // (la notif qu'on vient de vérifier en DB), effectivement publiés sur
        // le bus pub/sub — pas juste construits en mémoire par le processor.
        // Filtre par `groupId` (top-level sur tout WsEvent) plutôt que
        // `payload.eventId` : `notification:created` ne porte pas `eventId`
        // dans son payload (seul `event:reminder` le fait), et chaque
        // itération `it.each` crée son propre groupe, donc `groupId` isole
        // suffisamment sans dépendre de la shape du payload.
        // `publishNexusEvent` est awaited par le processor avant que le job
        // ne complète, mais la propagation pub/sub jusqu'à notre subscriber
        // a sa propre latence réseau : on poll un court instant plutôt que
        // de lire `allPublished` en synchrone.
        const forThisEvent = () => allPublished.filter((e) => e.groupId === group.id);
        const deadline = Date.now() + 2000;
        while (forThisEvent().length < 2 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        const types = forThisEvent().map((e) => e.type);
        expect(types).toContain('event:reminder');
        expect(types).toContain('notification:created');
      } finally {
        await worker.close();
        ownConnection?.disconnect();
      }
    },
    15_000,
  );
});
