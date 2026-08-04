/**
 * Test d'intégration schema pour `password_reset_tokens` (cf. MAN-171, phase
 * 1 de MAN-166 « mot de passe oublié — reset complet »).
 *
 * Ce n'est pas un test de route (aucune route n'existe encore à cette phase :
 * elle ne fait que poser la table) — il vérifie directement que la migration
 * `0017_add_password_reset_tokens.sql` s'applique proprement et que les
 * contraintes du schema (FK cascade, UNIQUE sur `tokenHash`, defaults)
 * tiennent une fois la table réellement créée en base.
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB), comme le reste
 * des tests d'intégration backend (cf. `just test-integration`).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { createDbClient } from '../client.js';

import { passwordResetTokens, users } from './index.js';

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

describe('password_reset_tokens table', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping password_reset_tokens integration tests');
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

  it('insère un jeton de reset et applique les defaults (usedAt=null, createdAt posé)', async () => {
    const user = await insertUser('reset-defaults@example.com');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const [token] = await client.db
      .insert(passwordResetTokens)
      .values({
        userId: user.id,
        tokenHash: 'hash-defaults',
        expiresAt,
      })
      .returning();

    expect(token).toBeDefined();
    expect(token?.usedAt).toBeNull();
    expect(token?.createdAt).toBeInstanceOf(Date);
    expect(token?.userId).toBe(user.id);
  });

  it('rejette deux jetons avec le même tokenHash (contrainte UNIQUE)', async () => {
    const user = await insertUser('reset-unique@example.com');
    const tokenHash = 'hash-unique';
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await client.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    await expect(
      client.db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      }),
    ).rejects.toThrow();
  });

  it('supprime les jetons en cascade quand le user est supprimé', async () => {
    const user = await insertUser('reset-cascade@example.com');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await client.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: 'hash-cascade',
      expiresAt,
    });

    await client.db.delete(users).where(eq(users.id, user.id));

    const remaining = await client.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));
    expect(remaining).toHaveLength(0);
  });
});
