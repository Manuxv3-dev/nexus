import type { WsEvent } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';
import { getGroupMembers } from '../../ws/membership-cache.js';

// MAN-180 : la diffusion WS du changement de rôle passe par
// `publishNexusEvent` (bus Redis). On mock ce module plutôt que de dépendre
// d'une vraie connexion Redis pub/sub dans ce test d'intégration HTTP — le
// but ici est de vérifier le contrat de l'appel, pas la livraison WS
// bout-en-bout (couverte côté `nexus-relay`).
const publishNexusEventMock = vi.fn<(event: WsEvent) => Promise<void>>();
vi.mock('../../ws/nexus-event-bus.js', () => ({
  publishNexusEvent: (event: WsEvent): Promise<void> => publishNexusEventMock(event),
}));

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

interface AuthedUser {
  id: string;
  email: string;
  accessToken: string;
}

// Shapes minimales des réponses JSON utilisées dans ce fichier — évite
// `res.json()` non typé (retombe sur `any`, cf. light-my-request) et les
// `as {...}` redondants qui suivaient auparavant chaque appel.
interface RegisterReply {
  user: { id: string; email: string };
  accessToken: string;
}
interface GroupReply {
  group: { id: string; name: string; role?: string };
}
interface GroupsListReply {
  groups: { id: string; name: string }[];
}
interface InvitationReply {
  invitation: { id: string; slug: string; role: string };
}
interface MembersReply {
  members: { userId: string; role: string }[];
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
  const body = res.json<RegisterReply>();
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

  afterEach(() => {
    publishNexusEventMock.mockClear();
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
      const body = res.json<GroupReply>();
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
        .then((r) => r.json<GroupReply>());

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
        .then((r) => r.json<GroupReply>());

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/groups/${groupRes.group.id}`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<GroupReply>();
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
        .then((r) => r.json<GroupReply>());

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}`,
        headers: authHeader(alice),
        payload: { name: 'New' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<GroupReply>();
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
        .then((r) => r.json<GroupReply>());

      // Alice crée invitation member
      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());

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
        .then((r) => r.json<GroupReply>());

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(200);

      // Le groupe n'apparaît plus dans la liste d'Alice
      const list = await app
        .inject({ method: 'GET', url: '/api/v1/groups', headers: authHeader(alice) })
        .then((r) => r.json<GroupsListReply>());
      expect(list.groups.find((x) => x.id === g.group.id)).toBeUndefined();
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
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());

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
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());

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
      const body = res.json<MembersReply>();
      expect(body.members).toHaveLength(2);
      const members = body.members;
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
        .then((r) => r.json<GroupReply>());

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
        .then((r) => r.json<GroupReply>());

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
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());

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
      const list = listRes.json<GroupsListReply>();
      expect(list.groups.find((x) => x.id === g.group.id)).toBeUndefined();
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
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member', maxUses: 5 },
        })
        .then((r) => r.json<InvitationReply>());

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

    // MAN-182 : le kick doit suivre la même règle de rang strict que
    // PATCH .../role (canManageRole), pas juste "être admin+" — sinon un
    // admin peut contourner l'impossibilité de rétrograder un pair en le
    // kickant puis en le ré-invitant à un rang inférieur (cf. MAN-185).
    it('admin ne peut pas kick un autre admin (403)', async () => {
      const alice = await registerUser(app, 'alice14b@ex.com');
      const bob = await registerUser(app, 'bob14b@ex.com');
      const charlie = await registerUser(app, 'charlie14b@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin', maxUses: 5 },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(charlie),
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${charlie.id}`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(403);
      const body = res.json<{ error?: { code?: string } }>();
      expect(body.error?.code).toBe('PERMISSION_DENIED');
    });

    it('admin peut toujours kick un simple member', async () => {
      const alice = await registerUser(app, 'alice14c@ex.com');
      const bob = await registerUser(app, 'bob14c@ex.com');
      const charlie = await registerUser(app, 'charlie14c@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const memberInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${memberInv.invitation.slug}/accept`,
        headers: authHeader(charlie),
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${charlie.id}`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(200);
    });

    it('owner peut toujours kick un admin', async () => {
      const alice = await registerUser(app, 'alice14d@ex.com');
      const bob = await registerUser(app, 'bob14d@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}`,
        headers: authHeader(alice),
      });
      expect(res.statusCode).toBe(200);
    });

    it('le self-leave reste inconditionnel pour un admin ou un member, quel que soit le rang du groupe', async () => {
      const alice = await registerUser(app, 'alice14e@ex.com');
      const bob = await registerUser(app, 'bob14e@ex.com');
      const charlie = await registerUser(app, 'charlie14e@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      // bob est admin, charlie est member — les deux ne "gèrent" pas
      // forcément le rang de l'autre, mais chacun peut se retirer lui-même.
      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const memberInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${memberInv.invitation.slug}/accept`,
        headers: authHeader(charlie),
      });

      const bobLeave = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}`,
        headers: authHeader(bob),
      });
      expect(bobLeave.statusCode).toBe(200);

      const charlieLeave = await app.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${g.group.id}/members/${charlie.id}`,
        headers: authHeader(charlie),
      });
      expect(charlieLeave.statusCode).toBe(200);
    });
  });

  describe('PATCH /groups/:groupId/members/:userId/role', () => {
    it('owner promeut un member en admin', async () => {
      const alice = await registerUser(app, 'alice23@ex.com');
      const bob = await registerUser(app, 'bob23@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}/role`,
        headers: authHeader(alice),
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ member: { userId: string; role: string } }>();
      expect(body.member.userId).toBe(bob.id);
      expect(body.member.role).toBe('admin');
    });

    it('owner rétrograde un admin en member', async () => {
      const alice = await registerUser(app, 'alice24@ex.com');
      const bob = await registerUser(app, 'bob24@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}/role`,
        headers: authHeader(alice),
        payload: { role: 'member' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ member: { userId: string; role: string } }>();
      expect(body.member.role).toBe('member');
    });

    it('admin promeut un member en admin (rang strictement inférieur)', async () => {
      const alice = await registerUser(app, 'alice25@ex.com');
      const bob = await registerUser(app, 'bob25@ex.com');
      const charlie = await registerUser(app, 'charlie25@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const memberInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${memberInv.invitation.slug}/accept`,
        headers: authHeader(charlie),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${charlie.id}/role`,
        headers: authHeader(bob),
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ member: { userId: string; role: string } }>();
      expect(body.member.role).toBe('admin');
    });

    it('admin ne peut pas changer le rôle d’un autre admin (403)', async () => {
      const alice = await registerUser(app, 'alice26@ex.com');
      const bob = await registerUser(app, 'bob26@ex.com');
      const charlie = await registerUser(app, 'charlie26@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin', maxUses: 5 },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(charlie),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${charlie.id}/role`,
        headers: authHeader(bob),
        payload: { role: 'member' },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json<{ error?: { code?: string } }>();
      expect(body.error?.code).toBe('PERMISSION_DENIED');
    });

    it("admin ne peut pas changer le rôle de l'owner (403)", async () => {
      const alice = await registerUser(app, 'alice27@ex.com');
      const bob = await registerUser(app, 'bob27@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${adminInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${alice.id}/role`,
        headers: authHeader(bob),
        payload: { role: 'member' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('member ne peut changer aucun rôle (403)', async () => {
      const alice = await registerUser(app, 'alice28@ex.com');
      const bob = await registerUser(app, 'bob28@ex.com');
      const charlie = await registerUser(app, 'charlie28@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const memberInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member', maxUses: 5 },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${memberInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${memberInv.invitation.slug}/accept`,
        headers: authHeader(charlie),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${charlie.id}/role`,
        headers: authHeader(bob),
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(403);
    });

    it("refuse role='owner' via cet endpoint (400 validation)", async () => {
      const alice = await registerUser(app, 'alice29@ex.com');
      const bob = await registerUser(app, 'bob29@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const memberInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${memberInv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}/role`,
        headers: authHeader(alice),
        payload: { role: 'owner' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('target non-membre du groupe → 404', async () => {
      const alice = await registerUser(app, 'alice30@ex.com');
      const bob = await registerUser(app, 'bob30@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}/role`,
        headers: authHeader(alice),
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('refuse sans auth (401)', async () => {
      const alice = await registerUser(app, 'alice31@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${alice.id}/role`,
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('test_role_change_publishes_member_role_updated_event — diffuse un event WS member:role_updated', async () => {
      const alice = await registerUser(app, 'alice32@ex.com');
      const bob = await registerUser(app, 'bob32@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}/role`,
        headers: authHeader(alice),
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(200);

      expect(publishNexusEventMock).toHaveBeenCalledTimes(1);
      expect(publishNexusEventMock).toHaveBeenCalledWith({
        type: 'member:role_updated',
        groupId: g.group.id,
        timestamp: expect.any(Number),
        payload: { userId: bob.id, newRole: 'admin' },
      });
    });

    // MAN-180 — test d'acceptation de la tranche complète (Task 5).
    //
    // Contrairement au test ci-dessus (`test_role_change_publishes_member_
    // role_updated_event`), qui vérifie isolément le contrat de l'appel à
    // `publishNexusEvent`, celui-ci fait rejouer le parcours HTTP complet
    // décrit dans MAN-180 et vérifie la persistance de façon *indépendante*
    // du endpoint qui a fait la mutation : on relit l'état via
    // `GET /members` plutôt que de se fier à la seule réponse du PATCH.
    //
    // Limite assumée : ce repo n'a pas de harnais de test WS avec de vrais
    // clients connectés (recherché dans `packages/backend/src/ws/*.test.ts`
    // et ailleurs dans le repo — seul `connection-store.test.ts` existe, et
    // il ne couvre qu'un store en mémoire, pas une connexion réseau réelle).
    // La diffusion WS bout-en-bout (relay Redis → socket client) n'est donc
    // pas prouvée ici ni ailleurs dans le repo : on prouve seulement que le
    // handler HTTP appelle `publishNexusEvent` avec le bon contrat, ce qui
    // est le seul point d'intégration testable sans construire ce harnais.
    // Ne pas confondre ce test avec une preuve de livraison WS réelle.
    it("test d'acceptation MAN-180 — un owner change le rôle d'un member, la DB reflète le changement (relecture indépendante) et l'event WS est diffusé", async () => {
      const alice = await registerUser(app, 'alice33@ex.com');
      const bob = await registerUser(app, 'bob33@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'Acceptation MAN-180' },
        })
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      // Précondition : bob est bien member avant le changement.
      const before = await app
        .inject({
          method: 'GET',
          url: `/api/v1/groups/${g.group.id}/members`,
          headers: authHeader(alice),
        })
        .then((r) => r.json<MembersReply>());
      expect(before.members.find((m) => m.userId === bob.id)?.role).toBe('member');

      // Action : alice (owner) promeut bob en admin via l'endpoint cible.
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}/role`,
        headers: authHeader(alice),
        payload: { role: 'admin' },
      });
      expect(patchRes.statusCode).toBe(200);

      // Preuve de persistance : relecture via un endpoint DIFFÉRENT
      // (GET /members), pas juste la réponse du PATCH lui-même.
      const after = await app
        .inject({
          method: 'GET',
          url: `/api/v1/groups/${g.group.id}/members`,
          headers: authHeader(alice),
        })
        .then((r) => r.json<MembersReply>());
      expect(after.members.find((m) => m.userId === bob.id)?.role).toBe('admin');

      // Preuve de diffusion (limitée au contrat d'appel, cf. commentaire
      // ci-dessus — pas de harnais WS e2e dans ce repo).
      expect(publishNexusEventMock).toHaveBeenCalledWith({
        type: 'member:role_updated',
        groupId: g.group.id,
        timestamp: expect.any(Number),
        payload: { userId: bob.id, newRole: 'admin' },
      });
    });

    // MAN-180 (revue) — anti-leak : un non-membre ne doit rien apprendre de
    // ce endpoint. Le 404 doit être le même, corps compris, que celui d'un
    // groupe inexistant — sinon l'existence d'un groupe (et d'un membership
    // qu'on cible) devient observable.
    it("caller non-membre → 404 indistinguable d'un groupe inexistant", async () => {
      const alice = await registerUser(app, 'alice34@ex.com');
      const bob = await registerUser(app, 'bob34@ex.com');
      const mallory = await registerUser(app, 'mallory34@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const onRealGroup = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${g.group.id}/members/${bob.id}/role`,
        headers: authHeader(mallory),
        payload: { role: 'admin' },
      });
      const onUnknownGroup = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/00000000-0000-4000-8000-000000000000/members/${bob.id}/role`,
        headers: authHeader(mallory),
        payload: { role: 'admin' },
      });

      expect(onRealGroup.statusCode).toBe(404);
      expect(onUnknownGroup.statusCode).toBe(404);
      // `requestId` diffère par construction, le reste doit être identique.
      const strip = (raw: string) => {
        const { error } = JSON.parse(raw) as {
          error: { code: string; message: string; details: unknown; requestId: string };
        };
        return { code: error.code, message: error.message, details: error.details };
      };
      expect(strip(onRealGroup.body)).toEqual(strip(onUnknownGroup.body));

      // Et rien n'a bougé : ni la base, ni le bus WS.
      expect(publishNexusEventMock).not.toHaveBeenCalled();
      const members = await app
        .inject({
          method: 'GET',
          url: `/api/v1/groups/${g.group.id}/members`,
          headers: authHeader(alice),
        })
        .then((r) => r.json<MembersReply>());
      expect(members.members.find((m) => m.userId === bob.id)?.role).toBe('member');
    });

    // MAN-180 (revue) — garde-fou TOCTOU. `canManageRole` tranche sur le rôle
    // lu avant l'écriture ; si ce rôle change entre-temps (promotion
    // concurrente par un rang supérieur), l'UPDATE ne doit pas s'appliquer :
    // la décision d'autorisation ne portait pas sur cet état-là.
    it('test_role_change_rejects_stale_authorization_decision — 409 si le rôle a changé entre la lecture et l’écriture', async () => {
      const alice = await registerUser(app, 'alice35@ex.com');
      const bob = await registerUser(app, 'bob35@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });

      const { updateMemberRole } = await import('./service.js');

      // bob est `member` en base ; on rejoue une écriture dont la décision
      // avait été prise alors qu'il était `admin` → refusée.
      await expect(updateMemberRole(g.group.id, bob.id, 'member', 'admin')).rejects.toMatchObject({
        code: 'RESOURCE_CONFLICT',
      });

      // Le chemin nominal (rôle attendu = rôle réel) passe toujours.
      const updated = await updateMemberRole(g.group.id, bob.id, 'admin', 'member');
      expect(updated.role).toBe('admin');

      const after = await app
        .inject({
          method: 'GET',
          url: `/api/v1/groups/${g.group.id}/members`,
          headers: authHeader(alice),
        })
        .then((r) => r.json<MembersReply>());
      expect(after.members.find((m) => m.userId === bob.id)?.role).toBe('admin');
    });
  });

  describe('POST /groups/:groupId/transfer-ownership', () => {
    /** Crée un groupe (alice = owner) + un 2e user invité avec `role`. */
    async function setupGroupWithMember(
      ownerEmailSuffix: string,
      memberEmailSuffix: string,
      role: 'admin' | 'member',
    ): Promise<{ owner: AuthedUser; member: AuthedUser; groupId: string }> {
      const owner = await registerUser(app, `owner${ownerEmailSuffix}@ex.com`);
      const member = await registerUser(app, `member${memberEmailSuffix}@ex.com`);
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(owner),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(owner),
          payload: { role },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(member),
      });

      return { owner, member, groupId: g.group.id };
    }

    it('test_owner_transfers_ownership_200 — 200, nouvel owner + ancien owner rétrogradé admin', async () => {
      const { owner, member, groupId } = await setupGroupWithMember('40', '40', 'member');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/transfer-ownership`,
        headers: authHeader(owner),
        payload: { newOwnerUserId: member.id },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ ok: true }>();
      expect(body.ok).toBe(true);

      const after = await app
        .inject({
          method: 'GET',
          url: `/api/v1/groups/${groupId}/members`,
          headers: authHeader(owner),
        })
        .then((r) => r.json<MembersReply>());
      expect(after.members.find((m) => m.userId === member.id)?.role).toBe('owner');
      expect(after.members.find((m) => m.userId === owner.id)?.role).toBe('admin');
    });

    it('test_admin_cannot_transfer_ownership_403 — un admin (pas owner) tente le transfert', async () => {
      const { owner, member: admin, groupId } = await setupGroupWithMember('41', '41', 'admin');
      const target = await registerUser(app, 'target41@ex.com');
      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${groupId}/invitations`,
          headers: authHeader(owner),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(target),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/transfer-ownership`,
        headers: authHeader(admin),
        payload: { newOwnerUserId: target.id },
      });
      expect(res.statusCode).toBe(403);
    });

    it('test_member_cannot_transfer_ownership_403 — un member (pas owner) tente le transfert', async () => {
      const { owner, member, groupId } = await setupGroupWithMember('42', '42', 'member');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/transfer-ownership`,
        headers: authHeader(member),
        payload: { newOwnerUserId: owner.id },
      });
      expect(res.statusCode).toBe(403);
    });

    it('test_transfer_to_self_rejected — owner tente de se transférer la propriété à lui-même (400)', async () => {
      const owner = await registerUser(app, 'owner43@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(owner),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/transfer-ownership`,
        headers: authHeader(owner),
        payload: { newOwnerUserId: owner.id },
      });
      expect(res.statusCode).toBe(400);
    });

    it('test_transfer_to_non_member_404 — la cible ne fait pas partie du groupe', async () => {
      const owner = await registerUser(app, 'owner44@ex.com');
      const stranger = await registerUser(app, 'stranger44@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(owner),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/transfer-ownership`,
        headers: authHeader(owner),
        payload: { newOwnerUserId: stranger.id },
      });
      expect(res.statusCode).toBe(404);
    });

    it('test_transfer_publishes_ownership_transferred_event — diffuse un event WS group:ownership_transferred', async () => {
      const { owner, member, groupId } = await setupGroupWithMember('46', '46', 'member');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/transfer-ownership`,
        headers: authHeader(owner),
        payload: { newOwnerUserId: member.id },
      });
      expect(res.statusCode).toBe(200);

      expect(publishNexusEventMock).toHaveBeenCalledTimes(1);
      expect(publishNexusEventMock).toHaveBeenCalledWith({
        type: 'group:ownership_transferred',
        groupId,
        timestamp: expect.any(Number),
        payload: { previousOwnerUserId: owner.id, newOwnerUserId: member.id },
      });
    });

    it('test_transfer_from_group_where_caller_not_member_404 — caller non-membre du groupe → 404 (pas 403)', async () => {
      const owner = await registerUser(app, 'owner45@ex.com');
      const outsider = await registerUser(app, 'outsider45@ex.com');
      const target = await registerUser(app, 'target45@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(owner),
          payload: { name: 'G' },
        })
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(owner),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
      await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(target),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/transfer-ownership`,
        headers: authHeader(outsider),
        payload: { newOwnerUserId: target.id },
      });
      expect(res.statusCode).toBe(404);
    });

    // MAN-181 — test d'acceptation de la tranche complète (Task 5).
    //
    // Les tests ci-dessus vérifient chacun un aspect isolé (200 nominal,
    // 403 selon rôle, 400 self-transfer, 404 cible absente, contrat de
    // l'event WS). Aucun ne prouve que le transfert a un effet *réel et
    // durable* sur les capacités des deux comptes concernés — un bug qui
    // changerait le label `role` en base sans que l'enforcement d'autorisation
    // (`requireGroupRole`) le respecte passerait inaperçu. Ce test ferme ce
    // trou : il rejoue le parcours HTTP complet et prouve, via des actions
    // qui échouent ou réussissent selon le rôle courant (pas juste une
    // relecture passive), que l'ancien owner a réellement perdu ses
    // privilèges et que le nouveau les a réellement gagnés.
    //
    // Limite assumée (identique à MAN-180, cf. `test d'acceptation MAN-180`
    // plus haut dans ce fichier) : ce repo n'a pas de harnais de test WS avec
    // de vrais clients connectés — seul `publishNexusEvent` peut être espionné
    // (déjà fait par `test_transfer_publishes_ownership_transferred_event`
    // ci-dessus). On ne refait pas cette assertion ici pour ne pas dupliquer
    // une preuve déjà apportée ; ce test-ci porte sur les capacités, pas sur
    // la diffusion WS.
    it("test d'acceptation MAN-181 — le transfert d'ownership a un effet réel et durable sur les capacités des deux comptes", async () => {
      const alice = await registerUser(app, 'alice47@ex.com');
      const bob = await registerUser(app, 'bob47@ex.com');
      const carol = await registerUser(app, 'carol47@ex.com');
      const g = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(alice),
          payload: { name: 'Acceptation MAN-181' },
        })
        .then((r) => r.json<GroupReply>());

      for (const [user, role] of [
        [bob, 'member'],
        [carol, 'member'],
      ] as const) {
        const inv = await app
          .inject({
            method: 'POST',
            url: `/api/v1/groups/${g.group.id}/invitations`,
            headers: authHeader(alice),
            payload: { role },
          })
          .then((r) => r.json<InvitationReply>());
        await app.inject({
          method: 'POST',
          url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
          headers: authHeader(user),
        });
      }

      // Étape 1 : alice (owner) transfère la propriété à bob (member).
      const transferRes = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/transfer-ownership`,
        headers: authHeader(alice),
        payload: { newOwnerUserId: bob.id },
      });
      expect(transferRes.statusCode).toBe(200);

      // Étape 2 : persistance vérifiée par un chemin de lecture INDÉPENDANT
      // de celui qui a écrit (GET /members, pas la réponse du POST).
      const afterTransfer = await app
        .inject({
          method: 'GET',
          url: `/api/v1/groups/${g.group.id}/members`,
          headers: authHeader(bob),
        })
        .then((r) => r.json<MembersReply>());
      expect(afterTransfer.members.find((m) => m.userId === bob.id)?.role).toBe('owner');
      expect(afterTransfer.members.find((m) => m.userId === alice.id)?.role).toBe('admin');

      // Étape 3 : alice, maintenant admin (pas owner), ne peut plus exercer un
      // privilège owner-only — retente le même endpoint qui vient de lui être
      // retiré. La perte de propriété a donc une conséquence effective, pas
      // juste un label changé en base.
      const aliceRetryRes = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/transfer-ownership`,
        headers: authHeader(alice),
        payload: { newOwnerUserId: carol.id },
      });
      expect(aliceRetryRes.statusCode).toBe(403);

      // Étape 4 : bob, maintenant owner, peut exercer ce même privilège
      // owner-only vers un 3e membre — la preuve symétrique que le gain de
      // propriété est réel, pas cosmétique.
      const bobTransferRes = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/transfer-ownership`,
        headers: authHeader(bob),
        payload: { newOwnerUserId: carol.id },
      });
      expect(bobTransferRes.statusCode).toBe(200);

      // Relecture indépendante finale : carol owner, bob (ex-owner) rétrogradé
      // admin, alice (déjà admin depuis l'étape 1) inchangée.
      const final = await app
        .inject({
          method: 'GET',
          url: `/api/v1/groups/${g.group.id}/members`,
          headers: authHeader(alice),
        })
        .then((r) => r.json<MembersReply>());
      expect(final.members.find((m) => m.userId === carol.id)?.role).toBe('owner');
      expect(final.members.find((m) => m.userId === bob.id)?.role).toBe('admin');
      expect(final.members.find((m) => m.userId === alice.id)?.role).toBe('admin');
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
        .then((r) => r.json<GroupReply>());

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/invitations`,
        headers: authHeader(alice),
        payload: { role: 'member' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<InvitationReply>();
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
        .then((r) => r.json<GroupReply>());

      const adminInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());

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
        .then((r) => r.json<GroupReply>());

      const memInv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());

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
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'admin' },
        })
        .then((r) => r.json<InvitationReply>());

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
        headers: authHeader(bob),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<GroupReply>();
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
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member', maxUses: 5 },
        })
        .then((r) => r.json<InvitationReply>());

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
        .then((r) => r.json<MembersReply>());
      const bobCount = members.members.filter((m) => m.userId === bob.id).length;
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
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());

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
        .then((r) => r.json<GroupReply>());

      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member', maxUses: 1 },
        })
        .then((r) => r.json<InvitationReply>());

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
        .then((r) => r.json<GroupReply>());

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
        .then((r) => r.json<InvitationReply>());
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
        .then((r) => r.json<GroupReply>());
      const inv = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${g.group.id}/invitations`,
          headers: authHeader(alice),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());
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
        .then((r) => r.json<GroupReply>());
      const gB = await app
        .inject({
          method: 'POST',
          url: '/api/v1/groups',
          headers: authHeader(bob),
          payload: { name: 'B' },
        })
        .then((r) => r.json<GroupReply>());

      // Bob crée invitation pour SON groupe
      const invB = await app
        .inject({
          method: 'POST',
          url: `/api/v1/groups/${gB.group.id}/invitations`,
          headers: authHeader(bob),
          payload: { role: 'member' },
        })
        .then((r) => r.json<InvitationReply>());

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
