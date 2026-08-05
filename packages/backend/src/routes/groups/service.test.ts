/**
 * Tests unitaires de `canManageRole` (MAN-180 — gestion des membres de
 * groupe, phase 1 : changement de rôle).
 *
 * Fonction pure : pas de mock nécessaire, on couvre la table de vérité
 * complète des 3x3 combinaisons de rôles owner/admin/member.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../core/errors.js';
import { closeDb, getDb } from '../../db/client.js';
import { groupMembers, groups, users } from '../../db/schema/index.js';
import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';

import { canManageRole, removeMember, transferOwnership } from './service.js';

describe('canManageRole', () => {
  it('test_canManageRole_owner_can_manage_admin', () => {
    expect(canManageRole('owner', 'admin')).toBe(true);
  });

  it('test_canManageRole_owner_can_manage_member', () => {
    expect(canManageRole('owner', 'member')).toBe(true);
  });

  it('test_canManageRole_owner_cannot_manage_owner', () => {
    expect(canManageRole('owner', 'owner')).toBe(false);
  });

  it('test_canManageRole_admin_can_manage_member', () => {
    expect(canManageRole('admin', 'member')).toBe(true);
  });

  it('test_canManageRole_admin_cannot_manage_admin', () => {
    expect(canManageRole('admin', 'admin')).toBe(false);
  });

  it('test_canManageRole_admin_cannot_manage_owner', () => {
    expect(canManageRole('admin', 'owner')).toBe(false);
  });

  it('test_canManageRole_member_cannot_manage_anyone', () => {
    expect(canManageRole('member', 'member')).toBe(false);
    expect(canManageRole('member', 'admin')).toBe(false);
    expect(canManageRole('member', 'owner')).toBe(false);
  });
});

/**
 * Tests d'intégration de `transferOwnership` (MAN-181 — phase 2 : transfert
 * de propriété de groupe). Nécessite un vrai Postgres (schema temporaire par
 * run, cf. `setupTestDb`) : skip auto si indisponible (sandbox sans DB).
 */
const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

describe('transferOwnership', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping transferOwnership integration tests');
    return;
  }

  let testDb: TestDb;
  let db: ReturnType<typeof getDb>;

  beforeAll(async () => {
    testDb = await setupTestDb(BASE_DB_URL);
    setTestEnv();
    process.env['DATABASE_URL'] = testDb.url;
    const { resetEnvCache } = await import('../../core/env.js');
    resetEnvCache();
    db = getDb();
  });

  afterAll(async () => {
    await closeDb();
    if (testDb) await testDb.cleanup();
  });

  let userCounter = 0;

  /** Crée un user minimal directement en base (pas besoin du flow d'auth ici). */
  async function createUser(): Promise<string> {
    userCounter += 1;
    const [user] = await db
      .insert(users)
      .values({
        email: `user-${userCounter}-${Date.now()}@ex.com`,
        passwordHash: 'not-used-in-these-tests',
        displayName: `User ${userCounter}`,
      })
      .returning();
    if (!user) throw new Error('createUser: insert failed');
    return user.id;
  }

  async function createGroup(ownerId: string): Promise<string> {
    const [group] = await db
      .insert(groups)
      .values({ name: 'Groupe de test', createdBy: ownerId })
      .returning();
    if (!group) throw new Error('createGroup: insert failed');
    await db.insert(groupMembers).values({ groupId: group.id, userId: ownerId, role: 'owner' });
    return group.id;
  }

  async function addMember(
    groupId: string,
    userId: string,
    role: 'admin' | 'member',
  ): Promise<void> {
    await db.insert(groupMembers).values({ groupId, userId, role });
  }

  async function roleOf(groupId: string, userId: string): Promise<string | undefined> {
    const rows = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
    return rows[0]?.role;
  }

  afterEach(async () => {
    // Nettoyage entre tests : groups en cascade sur group_members via FK.
    await db.delete(groups);
    await db.delete(users);
  });

  it('test_transferOwnership_moves_owner_role_atomically', async () => {
    const owner = await createUser();
    const target = await createUser();
    const groupId = await createGroup(owner);
    await addMember(groupId, target, 'member');

    await transferOwnership(groupId, owner, target);

    expect(await roleOf(groupId, target)).toBe('owner');
  });

  it('test_transferOwnership_previous_owner_becomes_admin', async () => {
    const owner = await createUser();
    const target = await createUser();
    const groupId = await createGroup(owner);
    await addMember(groupId, target, 'member');

    await transferOwnership(groupId, owner, target);

    expect(await roleOf(groupId, owner)).toBe('admin');
  });

  it('test_transferOwnership_rejects_self_transfer', async () => {
    const owner = await createUser();
    const groupId = await createGroup(owner);

    await expect(transferOwnership(groupId, owner, owner)).rejects.toThrow(AppError);
    expect(await roleOf(groupId, owner)).toBe('owner');
  });

  it('test_transferOwnership_rejects_non_member_target', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const groupId = await createGroup(owner);

    await expect(transferOwnership(groupId, owner, outsider)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(await roleOf(groupId, owner)).toBe('owner');
  });

  it('test_transferOwnership_target_not_yet_admin_becomes_owner_directly', async () => {
    const owner = await createUser();
    const target = await createUser();
    const groupId = await createGroup(owner);
    await addMember(groupId, target, 'member');

    await transferOwnership(groupId, owner, target);

    expect(await roleOf(groupId, target)).toBe('owner');
    expect(await roleOf(groupId, owner)).toBe('admin');
  });

  /**
   * Attend qu'un backend Postgres soit bloqué en attente d'un verrou sur
   * `group_members` — évite un `sleep` arbitraire pour séquencer la course.
   */
  async function waitForLockWait(timeoutMs = 5000): Promise<void> {
    const startedAt = Date.now();
    for (;;) {
      const rows = await testDb.sql<{ n: number }[]>`
        select count(*)::int as n
        from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and query ilike '%group_members%'`;
      if ((rows[0]?.n ?? 0) > 0) return;
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('waitForLockWait: aucun statement en attente de verrou');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * Régression (revue MAN-181) : en READ COMMITTED, le SELECT initial de
   * `transferOwnership` ne protège pas la ligne de la cible pour le reste de
   * la transaction. Une éjection concurrente committée entre ce SELECT et
   * l'UPDATE de promotion faisait matcher 0 ligne en silence, la transaction
   * committait quand même, et le groupe se retrouvait SANS AUCUN owner.
   *
   * Séquencement déterministe : une connexion tierce verrouille la ligne de
   * l'owner (`FOR UPDATE`), ce qui suspend la rétrogradation juste après le
   * SELECT de la cible ; on éjecte la cible pendant cette fenêtre, puis on
   * relâche le verrou.
   */
  it('test_transferOwnership_rolls_back_when_target_membership_disappears_mid_transaction', async () => {
    const owner = await createUser();
    const target = await createUser();
    const groupId = await createGroup(owner);
    await addMember(groupId, target, 'member');

    const conn = await testDb.sql.reserve();
    try {
      await conn`begin`;
      await conn`select 1 from group_members where group_id = ${groupId} and user_id = ${owner} for update`;

      const transfer = transferOwnership(groupId, owner, target);
      await waitForLockWait();

      // Transaction concurrente : la cible quitte / est éjectée du groupe.
      await db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, target)));

      await conn`commit`;

      await expect(transfer).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
    } finally {
      try {
        await conn`rollback`;
      } catch {
        // déjà committée : rien à annuler
      }
      conn.release();
    }

    // Invariante : le groupe a toujours exactement un owner.
    expect(await roleOf(groupId, owner)).toBe('owner');
  });

  /**
   * Régression (revue MAN-181) : contrepartie de la course ci-dessus, côté
   * kick. La route relit le rôle de la cible avant de refuser la suppression
   * d'un owner ; depuis que l'ownership est transférable, la cible peut
   * devenir owner entre cette lecture et le DELETE. Le service doit donc
   * refuser lui-même de supprimer une ligne `owner`.
   */
  it('test_removeMember_refuses_to_delete_the_owner_row', async () => {
    const owner = await createUser();
    const groupId = await createGroup(owner);

    await expect(removeMember(groupId, owner)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(await roleOf(groupId, owner)).toBe('owner');
  });

  it('test_removeMember_still_deletes_a_non_owner_member', async () => {
    const owner = await createUser();
    const member = await createUser();
    const groupId = await createGroup(owner);
    await addMember(groupId, member, 'member');

    await removeMember(groupId, member);

    expect(await roleOf(groupId, member)).toBeUndefined();
  });

  it('test_transferOwnership_rejects_when_caller_is_not_current_owner', async () => {
    const owner = await createUser();
    const notOwner = await createUser();
    const target = await createUser();
    const groupId = await createGroup(owner);
    await addMember(groupId, notOwner, 'admin');
    await addMember(groupId, target, 'member');

    await expect(transferOwnership(groupId, notOwner, target)).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
    });
    expect(await roleOf(groupId, owner)).toBe('owner');
    expect(await roleOf(groupId, notOwner)).toBe('admin');
    expect(await roleOf(groupId, target)).toBe('member');
  });
});
