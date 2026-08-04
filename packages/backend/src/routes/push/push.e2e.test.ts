/**
 * Test d'acceptation e2e du pipe push (cf. MAN-142, phase 1 de MAN-24
 * « notifications push PWA », task 6/6 — dernière tranche).
 *
 * Contrairement à `repo.test.ts` (routes push isolées) et
 * `notifications/repo.test.ts` (hook push testé via `insertNotification`
 * appelé directement), ce fichier exerce la tranche verticale complète
 * bout-en-bout via l'app Fastify réellement montée :
 *   POST /push/subscribe (HTTP) → insertNotification (choke point) →
 *   webpush.sendNotification (mocké) appelé avec le bon endpoint →
 *   DELETE /push/subscribe (HTTP) → re-déclenchement → plus aucun appel.
 *
 * `web-push` est mocké — Postgres reste réel (via `setupTestDb`). Skip auto
 * si Postgres n'est pas joignable (sandbox sans DB), même pattern que les
 * autres tests d'intégration du module.
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

describe('push e2e — subscribe → notification → unsubscribe (MAN-142, acceptation Phase 1)', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping push e2e test');
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

  it('subscribe déclenche le push sur notif, unsubscribe le coupe définitivement', async () => {
    const { insertNotification } = await import('../notifications/repo.js');

    const u = await registerUser(app, 'push-e2e@ex.com');
    const endpoint = 'https://push.example.com/e2e/sub-1';

    // 1. POST /push/subscribe — vraie route HTTP montée.
    const subscribeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'p256dh-e2e', auth: 'auth-e2e' } },
    });
    expect(subscribeRes.statusCode).toBe(200);
    expect(subscribeRes.json()).toEqual({ ok: true });

    // 2. Déclenche une vraie notification via le choke point d'insertion
    // (kind actif par défaut — pas de pref désactivée pour ce user neuf).
    const firstRow = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });
    expect(firstRow).not.toBeNull();

    // 3. webpush.sendNotification a bien été appelé avec l'endpoint souscrit.
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [subscriptionArg] = sendNotificationMock.mock.calls[0] as [{ endpoint: string }];
    expect(subscriptionArg.endpoint).toBe(endpoint);

    // 4. DELETE /push/subscribe — vraie route HTTP montée, même endpoint.
    const unsubscribeRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint },
    });
    expect(unsubscribeRes.statusCode).toBe(200);
    expect(unsubscribeRes.json()).toEqual({ ok: true });

    // 5. Re-déclenche une notification du même kind pour le même user.
    const secondRow = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
    });
    expect(secondRow).not.toBeNull();

    // 6. Plus aucun appel supplémentaire après le unsubscribe — le compteur
    // total reste à 1 (celui d'avant le DELETE), pas juste "au moins un".
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });
});
