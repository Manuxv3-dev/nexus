import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { setTestEnv } from '../test/helpers.js';
import { isPostgresAvailable, setupTestDb, type TestDb } from '../test/db.js';
import { isRedisAvailable } from '../test/redis.js';

import type { FastifyInstance } from 'fastify';

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379/15';

interface AuthedUser {
  id: string;
  email: string;
  accessToken: string;
}

async function registerUser(
  app: FastifyInstance,
  email: string,
  displayName = email.split('@')[0] ?? 'user',
): Promise<AuthedUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email,
      password: 'a-very-long-password-x',
      displayName,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`registerUser ${email} failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as { user: { id: string; email: string }; accessToken: string };
  return { id: body.user.id, email: body.user.email, accessToken: body.accessToken };
}

function authHeader(user: AuthedUser): { authorization: string } {
  return { authorization: `Bearer ${user.accessToken}` };
}

interface CapturedMessage {
  type: string;
  groupId?: string;
  payload: unknown;
}

/**
 * Connecte un WS client à `ws://...:port/ws?token=...` et collecte les events
 * reçus. Renvoie le client + une promise qui résolt à la fermeture.
 */
async function connectWs(
  port: number,
  accessToken: string,
): Promise<{ ws: WebSocket; received: CapturedMessage[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${accessToken}`);
  const received: CapturedMessage[] = [];
  ws.on('message', (data: Buffer) => {
    try {
      received.push(JSON.parse(data.toString('utf8')) as CapturedMessage);
    } catch {
      // ignore
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(err));
  });
  return { ws, received };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

/**
 * Tests d'intégration anti-leak du bridge-relay (cf. J3c-4).
 *
 * Skip auto si Postgres ou Redis n'est pas joignable.
 *
 * Couvre :
 *  - Un membre du groupe propriétaire de la session reçoit `message:new`
 *  - Un user externe au groupe ne reçoit RIEN
 *  - Un user dans un autre groupe (avec une autre session) ne reçoit rien
 *    de la session du premier groupe
 */
describe('bridge-relay — anti-leak WS cross-group', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);
  const redisUp = await isRedisAvailable(REDIS_URL);

  it.skipIf(!pgUp || !redisUp)('placeholder when infra unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp || !redisUp) {
    // eslint-disable-next-line no-console
    console.warn(
      `  ⚠ Infra unavailable (pg=${pgUp ? 'ok' : 'KO'}, redis=${redisUp ? 'ok' : 'KO'}), skipping bridge-relay tests`,
    );
    return;
  }

  let testDb: TestDb;
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    testDb = await setupTestDb(BASE_DB_URL);
    setTestEnv();
    process.env['NODE_ENV'] = 'development'; // pour activer startBridgeRelay
    process.env['DATABASE_URL'] = testDb.url;
    process.env['ENCRYPTION_KEY_BRIDGES'] = Buffer.from(
      'a'.repeat(32),
      'utf8',
    ).toString('base64');
    const { resetEnvCache } = await import('../core/env.js');
    resetEnvCache();
    const { resetEncryptionKeyCache } = await import('../integrations/core/encryption.js');
    resetEncryptionKeyCache();

    const { buildServer } = await import('../server.js');
    app = await buildServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    port = addr.port;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import('../db/client.js');
    const { closeRedis } = await import('../db/health.js');
    const { closeEventBus } = await import('../integrations/core/event-bus.js');
    await closeEventBus();
    await closeDb();
    await closeRedis();
    await testDb.cleanup();
  }, 30_000);

  it('un membre du groupe reçoit l\'event, un externe ne reçoit rien', async () => {
    // Setup : Alice + Bob, 2 groupes séparés, session Discord dans G1
    const alice = await registerUser(app, 'alice-relay@ex.com');
    const bob = await registerUser(app, 'bob-relay@ex.com');

    const aliceGroup = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: authHeader(alice),
        payload: { name: 'G1' },
      })
      .then((r) => (r.json() as { group: { id: string } }).group);

    const bobGroup = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: authHeader(bob),
        payload: { name: 'G2' },
      })
      .then((r) => (r.json() as { group: { id: string } }).group);

    void bobGroup; // utilisé pour s'assurer que Bob a un groupe (pas le G1)

    // Crée une session messaging directement via le service (on bypass OAuth Discord)
    const { createSession } = await import('../integrations/core/session-store.js');
    const session = await createSession({
      groupId: aliceGroup.id,
      providerType: 'discord',
      externalId: 'guild-test-relay-1',
      displayName: 'Test Guild',
      createdBy: alice.id,
    });

    // Connecte les deux users en WS
    const aliceWs = await connectWs(port, alice.accessToken);
    const bobWs = await connectWs(port, bob.accessToken);

    try {
      // Laisse le relay s'abonner et les sockets se settle
      await new Promise((r) => setTimeout(r, 200));

      // Publish un BridgeEvent message:new sur la session d'Alice
      const { publishBridgeEvent } = await import('../integrations/core/event-bus.js');
      await publishBridgeEvent({
        kind: 'message:new',
        sessionId: session.id,
        providerType: 'discord',
        timestamp: Date.now(),
        message: {
          externalId: 'm-test-1',
          channelExternalId: 'ch-1',
          authorExternalId: 'u-discord',
          authorDisplayName: 'Discord User',
          authorAvatarUrl: null,
          content: 'hello from discord',
          replyToExternalId: null,
          attachments: [],
          reactions: [],
          isEdited: false,
          isDeleted: false,
          externalCreatedAt: new Date().toISOString(),
          externalEditedAt: null,
        },
      });

      // Alice doit recevoir l'event message:new
      await waitFor(
        () => aliceWs.received.some((m) => m.type === 'message:new'),
        3000,
      );

      const aliceMsgEvent = aliceWs.received.find((m) => m.type === 'message:new');
      expect(aliceMsgEvent).toBeDefined();
      expect(aliceMsgEvent?.groupId).toBe(aliceGroup.id);

      // Bob ne doit jamais recevoir le message:new (anti-leak)
      // On laisse 500ms supplémentaires au cas où il y aurait du retard
      await new Promise((r) => setTimeout(r, 500));
      const bobMsgEvent = bobWs.received.find((m) => m.type === 'message:new');
      expect(bobMsgEvent).toBeUndefined();
    } finally {
      aliceWs.ws.close();
      bobWs.ws.close();
    }
  }, 15_000);
});
