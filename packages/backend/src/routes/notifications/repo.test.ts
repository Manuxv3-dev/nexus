/**
 * Tests d'intégration du hook push sur le choke point d'insertion des
 * notifications (cf. MAN-142, phase 1 de MAN-24 « notifications push PWA » ;
 * mis à jour par le ticket Cortex `505c6a76` — l'envoi push sort du chemin
 * HTTP via un job BullMQ).
 *
 * `insertNotification`/`insertNotificationsBulk` (routes/notifications/repo.ts)
 * enqueuent un job sur la queue `push-send` (`getPushSendQueue().add(...)`,
 * via `addWithTimeout`, cf. `workers/queues.ts`) après un insert réussi, au
 * lieu d'awaiter `sendPushToUsers` en direct. `workers/queues.js` est
 * partiellement mocké (seul `getPushSendQueue` est stubé, le reste du module
 * reste réel via `importOriginal` — les autres queues, ex. `event-reminders`,
 * ne sont pas concernées par ce test) : on vérifie que l'enqueue se déclenche
 * (ou pas) selon le kind/prefs, avec le bon payload (`targets`), sans
 * dépendre d'un vrai Redis ni d'un vrai push service. La résolution des
 * souscriptions (matching devices, contenu du payload par `previewEnabled`,
 * purge 404/410) vit désormais dans le worker et reste couverte par
 * `routes/push/repo.test.ts` (inchangé par ce ticket). Postgres reste réel
 * (via `setupTestDb`), pour exercer l'enforcement ADR-034 (prefs-repo), le
 * insert réel et l'ordre insert → enqueue (revue perf du ticket, cf. test
 * dédié plus bas).
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';
import type * as QueuesModule from '../../workers/queues.js';

const addMock = vi.fn();

vi.mock('../../workers/queues.js', async (importOriginal) => {
  const actual = await importOriginal<typeof QueuesModule>();
  return {
    ...actual,
    getPushSendQueue: (): { add: typeof addMock } => ({ add: addMock }),
  };
});

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

interface AuthedUser {
  id: string;
  email: string;
  accessToken: string;
}

async function registerUser(app: FastifyInstance, email: string): Promise<AuthedUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email,
      password: 'a-very-long-password-x',
      displayName: email.split('@')[0] ?? 'user',
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`registerUser ${email} failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json();
  return { id: body.user.id, email: body.user.email, accessToken: body.accessToken };
}

function auth(u: AuthedUser): { authorization: string } {
  return { authorization: `Bearer ${u.accessToken}` };
}

/** Crée un group via l'endpoint HTTP, renvoie son id. */
async function createGroup(app: FastifyInstance, owner: AuthedUser, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/groups',
    headers: auth(owner),
    payload: { name },
  });
  if (res.statusCode !== 200) {
    throw new Error(`createGroup failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ group: { id: string } }>().group.id;
}

interface PushSendTarget {
  userId: string;
  kind: string;
  groupId: string | null;
  sourceId: string | null;
}

/** Extrait `targets` du dernier appel `getPushSendQueue().add('push-send', { targets })`. */
function lastEnqueuedTargets(): PushSendTarget[] {
  const call = addMock.mock.calls[addMock.mock.calls.length - 1] as
    | [string, { targets: PushSendTarget[] }]
    | undefined;
  return call?.[1].targets ?? [];
}

describe('insertNotification/insertNotificationsBulk — hook push (enqueue BullMQ)', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping notifications repo push hook tests');
    return;
  }

  let testDb: TestDb;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await setupTestDb(BASE_DB_URL);
    setTestEnv();
    process.env['DATABASE_URL'] = testDb.url;
    const { resetEnvCache } = await import('../../core/env.js');
    resetEnvCache();

    const { buildServer } = await import('../../server.js');
    app = await buildServer();
  });

  afterAll(async () => {
    if (app) await app.close();
    const { closeDb } = await import('../../db/client.js');
    const { closeRedis } = await import('../../db/health.js');
    await closeDb();
    await closeRedis();
    if (testDb) await testDb.cleanup();
  });

  beforeEach(() => {
    addMock.mockReset();
    addMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('insertNotification enqueue le push quand le kind est actif (pref default true)', async () => {
    const { insertNotification } = await import('./repo.js');

    const u = await registerUser(app, 'push-hook-active@ex.com');

    const row = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });

    expect(row).not.toBeNull();
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledWith('push-send', {
      targets: [{ userId: u.id, kind: 'todo_assigned', groupId: null, sourceId: null }],
      enqueuedAt: expect.any(Number),
    });
  });

  it('insertNotification propage groupId/sourceId de la notif insérée dans le target enqueued (MAN-143 Phase 2)', async () => {
    const { insertNotification } = await import('./repo.js');

    const u = await registerUser(app, 'push-hook-deeplink@ex.com');
    const groupId = await createGroup(app, u, 'Deep-link grp');

    const sourceId = '11111111-1111-4111-8111-111111111111';
    const row = await insertNotification({
      userId: u.id,
      kind: 'expense_added',
      payload: {},
      groupId,
      sourceId,
    });

    expect(row).not.toBeNull();
    expect(addMock).toHaveBeenCalledTimes(1);
    // La résolution groupId/sourceId → `data.pane` (deep-link) vit dans
    // `buildPushPayload`, appelé par le worker — déjà couvert par
    // `routes/push/repo.test.ts` et `pushDeepLink.acceptance.test.ts`. Ici on
    // vérifie seulement que le choke point transmet bien ces champs au job.
    expect(lastEnqueuedTargets()).toEqual([
      { userId: u.id, kind: 'expense_added', groupId, sourceId },
    ]);
  });

  it('insertNotification sans groupId (notif cross-group) laisse le target groupId à null sans planter', async () => {
    const { insertNotification } = await import('./repo.js');

    const u = await registerUser(app, 'push-hook-crossgroup@ex.com');

    const row = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });

    expect(row).not.toBeNull();
    expect(lastEnqueuedTargets()).toEqual([
      { userId: u.id, kind: 'todo_assigned', groupId: null, sourceId: null },
    ]);
  });

  it("insertNotification n'enqueue aucun push quand le kind est désactivé (ADR-034)", async () => {
    const { insertNotification } = await import('./repo.js');
    const { updatePrefs } = await import('./prefs-repo.js');

    const u = await registerUser(app, 'push-hook-disabled@ex.com');
    await updatePrefs(u.id, { todoAssigned: false });

    const row = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });

    expect(row).toBeNull();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("insertNotification résout quand même si l'enqueue échoue (best-effort, ex. Redis down)", async () => {
    const { insertNotification } = await import('./repo.js');

    const u = await registerUser(app, 'push-hook-failure@ex.com');
    addMock.mockRejectedValue(new Error('redis down'));

    const row = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });

    expect(row).not.toBeNull();
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it('insertNotificationsBulk enqueue un seul job portant tous les destinataires insérés', async () => {
    const { insertNotificationsBulk } = await import('./repo.js');

    const a = await registerUser(app, 'push-hook-bulk-a@ex.com');
    const b = await registerUser(app, 'push-hook-bulk-b@ex.com');

    const rows = await insertNotificationsBulk([
      { userId: a.id, kind: 'event_reminder', payload: {} },
      { userId: b.id, kind: 'event_reminder', payload: {} },
    ]);

    expect(rows).toHaveLength(2);
    // Un seul job pour tout le lot — pas un par destinataire (cf.
    // `pushBestEffort` : le fan-out par device reste interne au worker).
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(lastEnqueuedTargets()).toEqual(
      expect.arrayContaining([
        { userId: a.id, kind: 'event_reminder', groupId: null, sourceId: null },
        { userId: b.id, kind: 'event_reminder', groupId: null, sourceId: null },
      ]),
    );
  });

  it("l'insert est committé en base AVANT l'enqueue (ordre insert → enqueue, revue perf 505c6a76)", async () => {
    const { insertNotification } = await import('./repo.js');
    const { getDb } = await import('../../db/client.js');
    const { notifications: notificationsTable } = await import('../../db/schema/index.js');
    const { and, eq } = await import('drizzle-orm');

    const u = await registerUser(app, 'push-hook-order@ex.com');

    // Lu DEPUIS le mock d'`add` (donc au moment même de l'enqueue) plutôt
    // qu'après coup : une lecture faite après `insertNotification` prouverait
    // juste que la ligne existe à la fin, pas qu'elle était déjà committée
    // quand l'enqueue a eu lieu.
    let rowSeenAtEnqueueTime: { id: string } | undefined;
    addMock.mockImplementation(async () => {
      const rows = await getDb()
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(
          and(eq(notificationsTable.userId, u.id), eq(notificationsTable.kind, 'todo_assigned')),
        );
      rowSeenAtEnqueueTime = rows[0];
    });

    const row = await insertNotification({ userId: u.id, kind: 'todo_assigned', payload: {} });

    expect(row).not.toBeNull();
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(rowSeenAtEnqueueTime).toBeDefined();
    expect(rowSeenAtEnqueueTime?.id).toBe(row?.id);
  });

  it("borne l'enqueue à ~2s si la queue ne répond jamais (Redis injoignable, revue perf 505c6a76)", async () => {
    const { insertNotification } = await import('./repo.js');
    const u = await registerUser(app, 'push-hook-timeout@ex.com');
    // Reproduit le comportement réel constaté empiriquement (le reviewer
    // l'a vérifié contre un port fermé) : `queue.add` ne rejette JAMAIS
    // quand Redis est injoignable, il pend indéfiniment.
    addMock.mockImplementation(() => new Promise(() => undefined));

    const start = Date.now();
    const row = await insertNotification({ userId: u.id, kind: 'todo_assigned', payload: {} });
    const elapsed = Date.now() - start;

    // La notif est bien insérée (best-effort : le push ne bloque jamais
    // l'écriture) et la fonction résout en un temps borné par
    // PUSH_ENQUEUE_TIMEOUT_MS (2s) + marge, pas en pendant indéfiniment
    // comme le ferait `queue.add` seul.
    expect(row).not.toBeNull();
    expect(elapsed).toBeLessThan(2500);
  }, 8_000);
});
