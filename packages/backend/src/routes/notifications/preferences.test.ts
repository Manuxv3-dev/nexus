/**
 * Tests d'intégration des préférences de notification (cf. ADR-034).
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 * Couvre :
 *   - GET renvoie les defaults all-true pour un user neuf (création paresseuse)
 *   - PATCH met à jour un flag et persiste (re-GET)
 *   - PATCH rejette une clé inconnue (strict → 400)
 *   - enforcement : un `kind` désactivé ne produit AUCUNE notif (et en produit
 *     une quand il est réactivé).
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

/** Crée un groupe (owner = u), invite `invitee` en member et le fait accepter. */
async function createGroupWithMember(
  app: FastifyInstance,
  owner: AuthedUser,
  invitee: AuthedUser,
  name: string,
): Promise<string> {
  const g = await app
    .inject({ method: 'POST', url: '/api/v1/groups', headers: auth(owner), payload: { name } })
    .then((r) => r.json<{ group: { id: string } }>());
  const inv = await app
    .inject({
      method: 'POST',
      url: `/api/v1/groups/${g.group.id}/invitations`,
      headers: auth(owner),
      payload: { role: 'member' },
    })
    .then((r) => r.json<{ invitation: { slug: string } }>());
  await app.inject({
    method: 'POST',
    url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
    headers: auth(invitee),
  });
  return g.group.id;
}

/** Crée une liste todo dans `groupId` et un item assigné à `assigneeId`. */
async function addAssignedTodo(
  app: FastifyInstance,
  owner: AuthedUser,
  groupId: string,
  assigneeId: string,
  text: string,
): Promise<void> {
  const list = await app
    .inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/todo-lists`,
      headers: auth(owner),
      payload: { title: 'Courses' },
    })
    .then((r) => r.json<{ todoList: { id: string } }>());
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/todo-lists/${list.todoList.id}/items`,
    headers: auth(owner),
    payload: { text, assigneeId },
  });
  if (res.statusCode !== 200) {
    throw new Error(`addAssignedTodo failed: ${res.statusCode} ${res.body}`);
  }
}

async function unreadKinds(app: FastifyInstance, u: AuthedUser): Promise<string[]> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications?unread=true&limit=100',
    headers: auth(u),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ notifications: { kind: string }[] }>();
  return body.notifications.map((n) => n.kind);
}

describe('notification preferences endpoint', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping notification prefs integration tests');
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

  it('GET renvoie les defaults all-true pour un user neuf', async () => {
    const u = await registerUser(app, 'prefs-default@ex.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/preferences',
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ preferences: Record<string, unknown> }>();
    expect(body.preferences['eventReminder']).toBe(true);
    expect(body.preferences['eventRsvpRequested']).toBe(true);
    expect(body.preferences['eventRsvpReceived']).toBe(true);
    expect(body.preferences['expenseAdded']).toBe(true);
    expect(body.preferences['todoAssigned']).toBe(true);
    expect(body.preferences['todoCompleted']).toBe(true);
    expect(typeof body.preferences['updatedAt']).toBe('string');
  });

  it('PATCH met à jour un flag et persiste', async () => {
    const u = await registerUser(app, 'prefs-patch@ex.com');
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      headers: auth(u),
      payload: { todoAssigned: false, eventReminder: false },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json<{ preferences: Record<string, unknown> }>();
    expect(patched.preferences['todoAssigned']).toBe(false);
    expect(patched.preferences['eventReminder']).toBe(false);
    expect(patched.preferences['expenseAdded']).toBe(true);

    // Re-GET : persistance
    const after = await app
      .inject({
        method: 'GET',
        url: '/api/v1/notifications/preferences',
        headers: auth(u),
      })
      .then((r) => r.json<{ preferences: Record<string, unknown> }>());
    expect(after.preferences['todoAssigned']).toBe(false);
    expect(after.preferences['eventReminder']).toBe(false);
  });

  it('PATCH rejette une clé inconnue (strict → 400)', async () => {
    const u = await registerUser(app, 'prefs-strict@ex.com');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      headers: auth(u),
      payload: { notAKind: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it('enforcement : un kind désactivé ne produit pas de notif, réactivé oui', async () => {
    const owner = await registerUser(app, 'prefs-enf-owner@ex.com');
    const assignee = await registerUser(app, 'prefs-enf-assignee@ex.com');
    const groupId = await createGroupWithMember(app, owner, assignee, 'Enforcement grp');

    // L'assigné désactive les notifs todo_assigned.
    const off = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      headers: auth(assignee),
      payload: { todoAssigned: false },
    });
    expect(off.statusCode).toBe(200);

    // Owner assigne une tâche à l'assigné → AUCUNE notif (kind désactivé).
    await addAssignedTodo(app, owner, groupId, assignee.id, 'Tâche silencieuse');
    expect(await unreadKinds(app, assignee)).not.toContain('todo_assigned');

    // L'assigné réactive, on réassigne → la notif arrive.
    const on = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/preferences',
      headers: auth(assignee),
      payload: { todoAssigned: true },
    });
    expect(on.statusCode).toBe(200);

    await addAssignedTodo(app, owner, groupId, assignee.id, 'Tâche notifiée');
    expect(await unreadKinds(app, assignee)).toContain('todo_assigned');
  });
});
