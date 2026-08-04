/**
 * Test d'intégration schema pour `push_subscriptions` (cf. MAN-142, phase 1
 * de MAN-24 « notifications push PWA »).
 *
 * Ce n'est pas un test de route (aucune route n'existe encore à cette phase :
 * elle ne fait que poser la table) — il vérifie directement que la migration
 * `0016_add_push_subscriptions.sql` s'applique proprement et que les
 * contraintes du schema (FK cascade, UNIQUE sur `endpoint`, defaults) tiennent
 * une fois la table réellement créée en base.
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB), comme le reste
 * des tests d'intégration backend (cf. `just test-integration`).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { createDbClient } from '../client.js';

import { pushSubscriptions, users } from './index.js';

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

describe('push_subscriptions table', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping push_subscriptions integration tests');
    return;
  }

  let testDb: TestDb;
  let client: ReturnType<typeof createDbClient>;

  beforeAll(async () => {
    testDb = await setupTestDb(BASE_DB_URL);
    client = createDbClient(testDb.url);
  });

  afterAll(async () => {
    await client.sql.end({ timeout: 5 });
    if (testDb) await testDb.cleanup();
  });

  async function insertUser(email: string) {
    const [user] = await client.db
      .insert(users)
      .values({ email, passwordHash: 'hash', displayName: 'Test User' })
      .returning();
    if (!user) throw new Error('insertUser: insert did not return a row');
    return user;
  }

  it('insère un abonnement et applique les defaults (previewEnabled=true, createdAt posé)', async () => {
    const user = await insertUser('push-defaults@example.com');

    const [sub] = await client.db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: 'https://push.example.com/sub/defaults',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
      })
      .returning();

    expect(sub).toBeDefined();
    expect(sub?.previewEnabled).toBe(true);
    expect(sub?.createdAt).toBeInstanceOf(Date);
    expect(sub?.userId).toBe(user.id);
  });

  it('rejette deux abonnements avec le même endpoint (contrainte UNIQUE)', async () => {
    const user = await insertUser('push-unique@example.com');
    const endpoint = 'https://push.example.com/sub/unique';

    await client.db.insert(pushSubscriptions).values({
      userId: user.id,
      endpoint,
      p256dh: 'p256dh-key',
      auth: 'auth-key',
    });

    await expect(
      client.db.insert(pushSubscriptions).values({
        userId: user.id,
        endpoint,
        p256dh: 'p256dh-key-2',
        auth: 'auth-key-2',
      }),
    ).rejects.toThrow();
  });

  it('supprime les abonnements en cascade quand le user est supprimé', async () => {
    const user = await insertUser('push-cascade@example.com');
    await client.db.insert(pushSubscriptions).values({
      userId: user.id,
      endpoint: 'https://push.example.com/sub/cascade',
      p256dh: 'p256dh-key',
      auth: 'auth-key',
    });

    await client.db.delete(users).where(eq(users.id, user.id));

    const remaining = await client.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id));
    expect(remaining).toHaveLength(0);
  });
});
