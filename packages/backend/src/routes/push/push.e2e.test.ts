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

import type { PushPayload } from './repo.js';

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

/**
 * Crée un group via l'endpoint HTTP, renvoie son id (même helper que
 * `notifications/repo.test.ts`). `notifications.group_id` est une FK vers
 * `groups.id` (cf. db/schema/index.ts) — un UUID inventé échouerait la
 * contrainte, il faut un vrai group pour tester le deep-link (`data.groupId`).
 */
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

  // Acceptation Phase 4 (MAN-145) : preuve bout-en-bout que le toggle
  // "Aperçu" (PATCH /push/subscribe) change bien le contenu envoyé au
  // navigateur, sans jamais affecter le deep-link (`data`, MAN-143 Phase 2).
  it('preview_toggle_e2e', async () => {
    const { insertNotification } = await import('../notifications/repo.js');

    const u = await registerUser(app, 'push-preview-e2e@ex.com');
    const endpoint = 'https://push.example.com/e2e/preview-toggle-1';
    // `notifications.group_id` est une FK vers `groups.id` (cf. db/schema) —
    // un UUID inventé échouerait la contrainte, il faut un vrai group.
    // `source_id` n'a pas de FK (juste `uuid`, pas de `.references()`), un
    // identifiant lisible suffit — mais on lui donne un vrai format UUID par
    // cohérence avec la colonne.
    const groupId = await createGroup(app, u, 'Preview toggle e2e grp');
    const sourceId = '22222222-2222-4222-8222-222222222222';

    // 1. POST /push/subscribe — vraie route HTTP montée.
    const subscribeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'p256dh-preview', auth: 'auth-preview' } },
    });
    expect(subscribeRes.statusCode).toBe(200);
    expect(subscribeRes.json()).toEqual({ ok: true });

    // 2. PATCH /push/subscribe { previewEnabled: false } — désactive l'aperçu
    // pour ce device avant la première notif.
    const disableRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, previewEnabled: false },
    });
    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json()).toEqual({ ok: true });

    // 3. Déclenche une vraie notification (même choke point que le test
    // Phase 1) — groupId/sourceId posés pour vérifier le deep-link plus bas.
    const firstRow = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
      groupId,
      sourceId,
    });
    expect(firstRow).not.toBeNull();

    // 4. Aperçu désactivé -> contenu générique, pas le titre/texte réel du kind.
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [, firstPayloadRaw] = sendNotificationMock.mock.calls[0] as [unknown, string];
    const firstPayload = JSON.parse(firstPayloadRaw) as PushPayload;
    expect(firstPayload.body).toBe('Nouvelle activité sur Nexus');
    expect(firstPayload.body).not.toBe('Une tâche vous a été assignée');
    expect(firstPayload.data).toEqual({
      groupId,
      pane: 'todo',
      sourceId,
    });

    // 5. PATCH /push/subscribe { previewEnabled: true } — réactive l'aperçu.
    const enableRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, previewEnabled: true },
    });
    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.json()).toEqual({ ok: true });

    // 6. Re-déclenche une notification du même kind.
    const secondRow = await insertNotification({
      userId: u.id,
      kind: 'todo_assigned',
      payload: {},
      groupId,
      sourceId,
    });
    expect(secondRow).not.toBeNull();

    // 7. Aperçu réactivé -> contenu complet cette fois, différent du contenu
    // générique de l'étape 4. Le deep-link (`data`), lui, reste identique —
    // le toggle Aperçu ne doit jamais l'affecter.
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const [, secondPayloadRaw] = sendNotificationMock.mock.calls[1] as [unknown, string];
    const secondPayload = JSON.parse(secondPayloadRaw) as PushPayload;
    expect(secondPayload.body).toBe('Une tâche vous a été assignée');
    expect(secondPayload.body).not.toBe(firstPayload.body);
    expect(secondPayload.data).toEqual(firstPayload.data);
  });
});
