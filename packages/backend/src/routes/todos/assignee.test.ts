/**
 * L'assigné d'un todo doit être membre du groupe (cf. ticket 621616bb).
 *
 * `POST /todo-lists/:listId/items` et `PATCH /todo-items/:itemId` acceptaient
 * n'importe quel `assigneeId` : le seul garde-fou était la FK
 * `todo_items.assignee_id → users`. Un membre pouvait donc assigner une tâche
 * à n'importe quel compte nexus — un inconnu, un ex-membre — qui recevait
 * alors un `todo_assigned` vers un groupe qu'il ne peut pas ouvrir (le
 * symptôme de a001d5d2, par une troisième entrée), et l'UI affichait un
 * fragment d'UUID faute de nom résolvable. Un UUID inconnu, lui, faisait
 * échouer l'INSERT sur la FK : une réponse différente selon que le compte
 * existe ou non, soit une énumération de comptes gratuite.
 *
 * Les deux routes s'alignent sur ce que `expenses` faisait déjà pour le payeur
 * et les parts (`assertAllMembers`) : membre du groupe, ou `VALIDATION_ERROR`
 * `user_not_member` — la même réponse qu'il s'agisse d'un compte étranger,
 * d'un ex-membre ou d'un UUID qui n'existe pas.
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

interface AuthedUser {
  id: string;
  email: string;
  accessToken: string;
}

function auth(u: AuthedUser): { authorization: string } {
  return { authorization: `Bearer ${u.accessToken}` };
}

interface ErrorBody {
  error: { code: string; details?: { reason?: string; userId?: string } | null };
}

describe("todos — l'assigné doit être membre du groupe", async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping todo assignee tests');
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

  async function registerUser(email: string): Promise<AuthedUser> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'a-very-long-password-x', displayName: email.split('@')[0] },
    });
    if (res.statusCode !== 200) throw new Error(`register ${email}: ${res.statusCode} ${res.body}`);
    const body = res.json<{ user: { id: string; email: string }; accessToken: string }>();
    return { id: body.user.id, email: body.user.email, accessToken: body.accessToken };
  }

  async function makeGroup(owner: AuthedUser, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: auth(owner),
      payload: { name },
    });
    if (res.statusCode !== 200) throw new Error(`makeGroup: ${res.statusCode} ${res.body}`);
    return res.json<{ group: { id: string } }>().group.id;
  }

  async function joinGroup(owner: AuthedUser, groupId: string, joiner: AuthedUser): Promise<void> {
    const inv = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/invitations`,
        headers: auth(owner),
        payload: { role: 'member' },
      })
      .then((r) => r.json<{ invitation: { slug: string } }>());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
      headers: auth(joiner),
    });
    if (res.statusCode !== 200) throw new Error(`joinGroup: ${res.statusCode} ${res.body}`);
  }

  async function leaveGroup(u: AuthedUser, groupId: string): Promise<void> {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${groupId}/members/${u.id}`,
      headers: auth(u),
    });
    if (res.statusCode !== 200) throw new Error(`leaveGroup: ${res.statusCode} ${res.body}`);
  }

  async function makeList(u: AuthedUser, groupId: string, title: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/todo-lists`,
      headers: auth(u),
      payload: { title },
    });
    if (res.statusCode !== 200) throw new Error(`makeList: ${res.statusCode} ${res.body}`);
    return res.json<{ todoList: { id: string } }>().todoList.id;
  }

  async function addItem(u: AuthedUser, listId: string, text: string, assigneeId?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/todo-lists/${listId}/items`,
      headers: auth(u),
      payload: assigneeId === undefined ? { text } : { text, assigneeId },
    });
  }

  async function listItems(u: AuthedUser, listId: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/todo-lists/${listId}`,
      headers: auth(u),
    });
    if (res.statusCode !== 200) throw new Error(`listItems: ${res.statusCode} ${res.body}`);
    return res.json<{
      todoList: { items: { id: string; text: string; assigneeId: string | null }[] };
    }>().todoList.items;
  }

  async function unreadCount(u: AuthedUser): Promise<number> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: auth(u),
    });
    if (res.statusCode !== 200) throw new Error(`notifications: ${res.statusCode} ${res.body}`);
    return res.json<{ unreadCount: number }>().unreadCount;
  }

  function expectNotMember(res: { statusCode: number; json: <T>() => T }, userId: string) {
    expect(res.statusCode).toBe(400);
    const body = res.json<ErrorBody>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.reason).toBe('user_not_member');
    expect(body.error.details?.userId).toBe(userId);
  }

  it("refuse à la création un assigné qui n'est pas membre — et ne le notifie pas", async () => {
    const alice = await registerUser('todo-assign-outsider-alice@ex.com');
    const carol = await registerUser('todo-assign-outsider-carol@ex.com');
    const groupId = await makeGroup(alice, 'Assign outsider');
    const listId = await makeList(alice, groupId, 'Courses');

    const res = await addItem(alice, listId, 'Pain', carol.id);

    expectNotMember(res, carol.id);
    // Rien n'a été écrit : ni l'item, ni le `todo_assigned` de Carol.
    expect(await listItems(alice, listId)).toEqual([]);
    expect(await unreadCount(carol)).toBe(0);
  });

  it('répond la même chose pour un UUID qui ne correspond à aucun compte', async () => {
    // Avant : l'INSERT tombait sur la FK `users`, donc une réponse différente
    // de celle d'un compte existant non membre — une énumération de comptes
    // gratuite. La vérification de membership passe AVANT l'écriture, et ne
    // distingue pas « inconnu » de « pas membre ».
    const alice = await registerUser('todo-assign-ghost-alice@ex.com');
    const groupId = await makeGroup(alice, 'Assign ghost');
    const listId = await makeList(alice, groupId, 'Courses');
    const ghost = '00000000-0000-4000-8000-00000000dead';

    const res = await addItem(alice, listId, 'Lait', ghost);

    expectNotMember(res, ghost);
    expect(await listItems(alice, listId)).toEqual([]);
  });

  it("refuse à la création d'une liste un item initial assigné à un non-membre — sans créer la liste", async () => {
    // Troisième entrée, une route au-dessus des deux autres : `initialItems`
    // de `POST /groups/:groupId/todo-lists`. Le web ne l'utilise jamais avec
    // un assigné, mais l'API l'accepte — et c'est là que le trou restait.
    const alice = await registerUser('todo-assign-initial-alice@ex.com');
    const carol = await registerUser('todo-assign-initial-carol@ex.com');
    const groupId = await makeGroup(alice, 'Assign initial');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/todo-lists`,
      headers: auth(alice),
      payload: { title: 'Courses', initialItems: [{ text: 'Pain', assigneeId: carol.id }] },
    });

    expectNotMember(res, carol.id);
    // La garde passe avant la transaction : ni liste, ni item.
    const lists = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/todo-lists`,
      headers: auth(alice),
    });
    expect(lists.statusCode).toBe(200);
    expect(lists.json<{ todoLists: unknown[] }>().todoLists).toEqual([]);
  });

  it('refuse à la modification un assigné qui a quitté le groupe — l’item reste tel quel', async () => {
    const alice = await registerUser('todo-assign-left-alice@ex.com');
    const bob = await registerUser('todo-assign-left-bob@ex.com');
    const groupId = await makeGroup(alice, 'Assign left');
    await joinGroup(alice, groupId, bob);
    const listId = await makeList(alice, groupId, 'Courses');
    const created = await addItem(alice, listId, 'Fromage');
    expect(created.statusCode).toBe(200);
    const itemId = created.json<{ todoItem: { id: string } }>().todoItem.id;

    await leaveGroup(bob, groupId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/todo-items/${itemId}`,
      headers: auth(alice),
      payload: { assigneeId: bob.id },
    });

    expectNotMember(res, bob.id);
    const [item] = await listItems(alice, listId);
    expect(item?.assigneeId).toBeNull();
    expect(await unreadCount(bob)).toBe(0);
  });

  it('accepte toujours un membre, et `null` pour désassigner', async () => {
    // Le contrôle positif : la garde ne doit pas mordre sur le chemin nominal.
    const alice = await registerUser('todo-assign-ok-alice@ex.com');
    const bob = await registerUser('todo-assign-ok-bob@ex.com');
    const groupId = await makeGroup(alice, 'Assign ok');
    await joinGroup(alice, groupId, bob);
    const listId = await makeList(alice, groupId, 'Courses');

    const res = await addItem(alice, listId, 'Vin', bob.id);
    expect(res.statusCode).toBe(200);
    const created = res.json<{ todoItem: { id: string; assigneeId: string | null } }>().todoItem;
    expect(created.assigneeId).toBe(bob.id);
    // Et Bob, membre, est bien notifié.
    expect(await unreadCount(bob)).toBe(1);

    const unassigned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/todo-items/${created.id}`,
      headers: auth(alice),
      payload: { assigneeId: null },
    });
    expect(unassigned.statusCode).toBe(200);
    expect(
      unassigned.json<{ todoItem: { assigneeId: string | null } }>().todoItem.assigneeId,
    ).toBeNull();
  });
});
