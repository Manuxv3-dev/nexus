import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';
import { getGroupMembers } from '../../ws/membership-cache.js';

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

interface AuthedUser {
  id: string;
  email: string;
  accessToken: string;
}

/**
 * Helper : enregistre un user et renvoie son accessToken + id.
 */
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
  const body = res.json();
  return { id: body.user.id, email: body.user.email, accessToken: body.accessToken };
}

function authHeader(user: AuthedUser): { authorization: string } {
  return { authorization: `Bearer ${user.accessToken}` };
}

/**
 * Tests d'intégration des endpoints groupes.
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 * Couvre : CRUD groupes, membres, invitations, anti-leak cross-group,
 * permissions par rôle, idempotence accept.
 */
describe('groups endpoints', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping groups integration tests');
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

  // ===== CRUD groupes ========================================================

  describe('POST /groups', () => {
    it('crée un groupe et retourne role=owner', async () => {
      const u = await registerUser(app, 'alice1@ex.com');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: authHeader(u),
        payload: { name: 'Les Potos' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.group.name).toBe('Les Potos');
      expect(body.group.role).toBe('owner');
    });

    it('refuse sans auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('valide le name (vide refusé)', async () => {
      const u = await registerUser(app, 'alice2@ex.com');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: authHeader(u),
        payload: { name: '' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /groups', () => {
    it("ne retourne que les groupes de l'user (anti-leak)", async () => {
      const alice = await registerUser(app, 'alice3@ex.com');
      const bob = await registerUser(app, 'bob3@ex.com');

      // Alice crée 2 groupes
      await app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: authHeader(alice),
        payload: { name: 'A1' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: authHeader(alice),
        payload: { name: 'A2' },
      });
      // Bob crée 1 groupe
      await app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: authHeader(bob),
        payload: { name: 'B1' },
      });

      const resAlice = await app.inject({
        method: 'GET',
        url: '/api/v1/groups',
        headers: authHeader(alice),
      });
      const aliceList = resAlice.json<{ groups: { name: string }[] }>().groups;
      expect(aliceList.map((g) => g.name).sort()).toEqual(['A1', 'A2']);

      const resBob = await app.inject({
        method: 'GET',
        url: '/api/v1/groups',
        headers: authHeader(bob),
      });
      const bobList = resBob.json<{ groups: { name: string }[] }>().groups;
      expect(bobList.map((g) => g.name)).toEqual(['B1']);
    });
  });

  describe('GET /groups/:groupId — anti-leak', () => {
    it("renvoie 404 si non-membre (pas 403, pour ne pas leak l'existence)", async () => {
      const alice = await registerUser(app, 'alice4@ex.com');
      const bob = await registerUser(app, 'bob4@ex.com');
      const aliceGroup = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'Privé' },
        })
        .then((r) => r.json());

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${aliceGroup.group.id}`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(404);
    });

    it('renvoie 200 + role pour un membre', async () => {
      const alice = await registerUser(app, 'alice5@ex.com');
      const groupRes = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'OK' },
        })
        .then((r) => r.json());

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${groupRes.group.id}`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.group.role).toBe('owner');
    });
  });

  describe('PATCH /groups/:groupId — rôle requis admin+', () => {
    it('owner peut renommer', async () => {
      const alice = await registerUser(app, 'alice6@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'Old' },
        })
        .then((r) => r.json());

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}`,
        headers: authHeader(alice),
        payload: { name: 'New' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.group.name).toBe('New');
    });

    it('member ne peut pas renommer (403)', async () => {
      const alice = await registerUser(app, 'alice7@ex.com');
      const bob = await registerUser(app, 'bob7@ex.com');

      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      // Alice crée invitation member
      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json());

      // Bob accept
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}`,
        headers: authHeader(bob),
        payload: { name: 'Hack' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /groups/:groupId — owner only', () => {
    it('owner peut delete', async () => {
      const alice = await registerUser(app, 'alice8@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'To delete' },
        })
        .then((r) => r.json());

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(200);

      // Le groupe n'apparaît plus dans la liste d'Alice
      const list = await app
        .inject({ method: 'GET', url: '/api/v1/groups', headers: authHeader(alice) })
        .then((r) => r.json());
      expect(
        (list as { groups: { id: string }[] }).groups.find(
          (x: { id: string }) => x.id === g.group.id,
        ),
      ).toBeUndefined();
    });

    it('admin ne peut pas delete (403)', async () => {
      const alice = await registerUser(app, 'alice9@ex.com');
      const bob = await registerUser(app, 'bob9@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json());

      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ===== Membres =============================================================

  describe('GET /groups/:groupId/members', () => {
    it('liste les membres avec leurs rôles', async () => {
      const alice = await registerUser(app, 'alice10@ex.com');
      const bob = await registerUser(app, 'bob10@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json());

      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${g.group.id}/members`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.members).toHaveLength(2);
      const members = (body as { members: { userId: string; role: string }[] }).members;
      const aliceM = members.find((m) => m.userId === alice.id);
      const bobM = members.find((m) => m.userId === bob.id);
      expect(aliceM?.role).toBe('owner');
      expect(bobM?.role).toBe('member');
    });

    it('non-membre → 404', async () => {
      const alice = await registerUser(app, 'alice11@ex.com');
      const bob = await registerUser(app, 'bob11@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${g.group.id}/members`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /groups/:groupId/members/:userId', () => {
    it('owner ne peut pas se retirer (cannot_remove_owner)', async () => {
      const alice = await registerUser(app, 'alice12@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${alice.id}`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(403);
    });

    it('member peut se self-leave', async () => {
      const alice = await registerUser(app, 'alice13@ex.com');
      const bob = await registerUser(app, 'bob13@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json());

      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(200);

      // Bob ne voit plus le groupe
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/groups',
        headers: authHeader(bob),
      });
      const list = listRes.json();
      expect(
        (list as { groups: { id: string }[] }).groups.find(
          (x: { id: string }) => x.id === g.group.id,
        ),
      ).toBeUndefined();
    });

    it('member ne peut pas kick un autre member (403)', async () => {
      const alice = await registerUser(app, 'alice14@ex.com');
      const bob = await registerUser(app, 'bob14@ex.com');
      const charlie = await registerUser(app, 'charlie14@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member', maxUses: 5 },
        })
        .then((r) => r.json());

      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(charlie),
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${charlie.id}`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ===== Invitations =========================================================

  describe('POST /groups/:groupId/invitations', () => {
    it('admin peut créer une invitation member', async () => {
      const alice = await registerUser(app, 'alice15@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/invitations`,
        headers: authHeader(alice),
        payload: { role: 'member' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.invitation.slug).toMatch(/^[A-Za-z0-9]+$/);
      expect(body.invitation.role).toBe('member');
    });

    it('admin ne peut pas créer une invitation owner (cannot_invite_to_higher_role)', async () => {
      const alice = await registerUser(app, 'alice16@ex.com');
      const bob = await registerUser(app, 'bob16@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json());

      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/invitations`,
        headers: authHeader(bob),
        payload: { role: 'owner' },
      });
      expect(res.statusCode).toBe(403);
    });

    it("member ne peut pas créer d'invitation (403)", async () => {
      const alice = await registerUser(app, 'alice17@ex.com');
      const bob = await registerUser(app, 'bob17@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const memInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json());

      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${memInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/invitations`,
        headers: authHeader(bob),
        payload: { role: 'member' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /invitations/:slug/accept', () => {
    it("user devient membre avec le rôle de l'invitation", async () => {
      const alice = await registerUser(app, 'alice18@ex.com');
      const bob = await registerUser(app, 'bob18@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'Welcome' },
        })
        .then((r) => r.json());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json());

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.group.id).toBe(g.group.id);
      expect(body.group.role).toBe('admin');
    });

    it('idempotent : déjà membre → renvoie ok sans erreur', async () => {
      const alice = await registerUser(app, 'alice19@ex.com');
      const bob = await registerUser(app, 'bob19@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member', maxUses: 5 },
        })
        .then((r) => r.json());

      const r1 = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      const r2 = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);

      // Bob n'apparaît qu'une fois dans les membres
      const members = await app
        .inject({
          method: 'GET',
          url: `/api/v1/groups/${g.group.id}/members`,
          headers: authHeader(alice),
        })
        .then((r) => r.json());
      const bobCount = (members as { members: { userId: string }[] }).members.filter(
        (m: { userId: string }) => m.userId === bob.id,
      ).length;
      expect(bobCount).toBe(1);
    });

    it('refuse une invitation révoquée (401)', async () => {
      const alice = await registerUser(app, 'alice20@ex.com');
      const bob = await registerUser(app, 'bob20@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json());

      await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/invitations/${inv.invitation.id}`,
        headers: authHeader(alice),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(401);
    });

    it('refuse une invitation au max_uses atteint (409)', async () => {
      const alice = await registerUser(app, 'alice21@ex.com');
      const bob = await registerUser(app, 'bob21@ex.com');
      const charlie = await registerUser(app, 'charlie21@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member', maxUses: 1 },
        })
        .then((r) => r.json());

      const r1 = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      expect(r1.statusCode).toBe(200);

      const r2 = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(charlie),
      });
      expect(r2.statusCode).toBe(409);
    });
  });

  describe('membership-cache invalidation (MAN-17)', () => {
    it('accept invitation invalide le cache — le nouveau membre apparaît sans attendre le TTL', async () => {
      const alice = await registerUser(app, 'alice-cache1@ex.com');
      const bob = await registerUser(app, 'bob-cache1@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'Cache invalidation' },
        })
        .then((r) => r.json());

      // Prime le cache avec la liste AVANT que Bob rejoigne (reproduit le
      // relay WS qui résout l'audience d'un broadcast au fil de l'eau).
      const before = await getGroupMembers(g.group.id);
      expect(before).toEqual([alice.id]);

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json());
      const accept = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      expect(accept.statusCode).toBe(200);

      // Sans invalidation, ce 2e appel renverrait encore le cache primé
      // ci-dessus (TTL 5 min) et raterait Bob.
      const after = await getGroupMembers(g.group.id);
      expect(new Set(after)).toEqual(new Set([alice.id, bob.id]));
    });

    it('removeMember invalide le cache — le membre retiré disparaît sans attendre le TTL', async () => {
      const alice = await registerUser(app, 'alice-cache2@ex.com');
      const bob = await registerUser(app, 'bob-cache2@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'Cache invalidation 2' },
        })
        .then((r) => r.json());
      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      // Prime le cache AVEC Bob dedans.
      const before = await getGroupMembers(g.group.id);
      expect(new Set(before)).toEqual(new Set([alice.id, bob.id]));

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(200);

      // Sans invalidation, ce 2e appel continuerait de compter Bob comme
      // destinataire des broadcasts WS pendant jusqu'à 5 min.
      const after = await getGroupMembers(g.group.id);
      expect(after).toEqual([alice.id]);
    });
  });

  describe('DELETE invitation — anti-leak cross-group', () => {
    it("ne permet pas de révoquer l'invitation d'un autre groupe (404)", async () => {
      const alice = await registerUser(app, 'alice22@ex.com');
      const bob = await registerUser(app, 'bob22@ex.com');
      const gA = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'A' },
        })
        .then((r) => r.json());
      const gB = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(bob),
          payload: { name: 'B' },
        })
        .then((r) => r.json());

      // Bob crée invitation pour SON groupe
      const invB = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${gB.group.id}/invitations`,
          headers: authHeader(bob),
          payload: { role: 'member' },
        })
        .then((r) => r.json());

      // Alice (admin de gA, étrangère à gB) tente de révoquer invB via gA
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${gA.group.id}/invitations/${invB.invitation.id}`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
