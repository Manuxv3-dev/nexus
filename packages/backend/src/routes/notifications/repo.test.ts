/**
 * Tests d'intégration du hook push sur le choke point d'insertion des
 * notifications (cf. MAN-142, phase 1 de MAN-24 « notifications push PWA »).
 *
 * `insertNotification`/`insertNotificationsBulk` (routes/notifications/repo.ts)
 * appellent `sendPushToUser` (routes/push/repo.ts) après un insert réussi.
 * `web-push` est mocké — on vérifie que `webpush.sendNotification` est bien
 * déclenché (ou pas) selon le kind/prefs, sans dépendre d'un vrai push
 * service. Postgres reste réel (via `setupTestDb`), pour exercer l'enforcement
 * ADR-034 (prefs-repo) et le insert réel.
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';

const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]): unknown => sendNotificationMock(...args),
    setVapidDetails: (...args: unknown[]): unknown => setVapidDetailsMock(...args),
  },
}));

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

/** Crée une souscription push pour `u` via l'endpoint HTTP (comme un vrai client). */
async function subscribe(app: FastifyInstance, u: AuthedUser, endpoint: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/push/subscribe',
    headers: auth(u),
    payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
  });
  if (res.statusCode !== 200) {
    throw new Error(`subscribe failed: ${res.statusCode} ${res.body}`);
  }
}

describe('insertNotification/insertNotificationsBulk — hook push', async () => {
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
    sendNotificationMock.mockReset();
    sendNotificationMock.mockResolvedValue(undefined);
    setVapidDetailsMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('insertNotification déclenche le push quand le kind est actif (pref default true)', async () => {
    const { insertNotification } = await import('./repo.js');

    const u = await registerUser(app, 'push-hook-active@ex.com');
    await subscribe(app, u, 'https://push.example.com/hook-active-1');

    const row = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });

    expect(row).not.toBeNull();
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [subscriptionArg] = sendNotificationMock.mock.calls[0] as [{ endpoint: string }];
    expect(subscriptionArg.endpoint).toBe('https://push.example.com/hook-active-1');
  });

  it('insertNotification ne déclenche aucun push quand le kind est désactivé (ADR-034)', async () => {
    const { insertNotification } = await import('./repo.js');
    const { updatePrefs } = await import('./prefs-repo.js');

    const u = await registerUser(app, 'push-hook-disabled@ex.com');
    await subscribe(app, u, 'https://push.example.com/hook-disabled-1');
    await updatePrefs(u.id, { todoAssigned: false });

    const row = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });

    expect(row).toBeNull();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('insertNotification résout quand même si le push échoue (best-effort)', async () => {
    const { insertNotification } = await import('./repo.js');

    const u = await registerUser(app, 'push-hook-failure@ex.com');
    await subscribe(app, u, 'https://push.example.com/hook-failure-1');
    sendNotificationMock.mockRejectedValue(new Error('push service down'));

    const row = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });

    expect(row).not.toBeNull();
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('insertNotificationsBulk déclenche 1 push par destinataire inséré', async () => {
    const { insertNotificationsBulk } = await import('./repo.js');

    const a = await registerUser(app, 'push-hook-bulk-a@ex.com');
    const b = await registerUser(app, 'push-hook-bulk-b@ex.com');
    await subscribe(app, a, 'https://push.example.com/hook-bulk-a-1');
    await subscribe(app, b, 'https://push.example.com/hook-bulk-b-1');

    const rows = await insertNotificationsBulk([
      { userId: a.id, kind: 'event_reminder', payload: {} },
      { userId: b.id, kind: 'event_reminder', payload: {} },
    ]);

    expect(rows).toHaveLength(2);
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
  });
});
