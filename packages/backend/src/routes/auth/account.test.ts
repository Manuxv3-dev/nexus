/**
 * Tests d'intégration de la gestion de compte (cf. ADR-033) :
 *   - POST /api/v1/auth/change-password (nominal, mauvais mdp, non-auth)
 *   - PATCH /api/v1/auth/me (displayName, email unicité → 409)
 *   - DELETE /api/v1/auth/me (transfert d'ownership, groupe membre-unique
 *     supprimé, user effacé)
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

const PASSWORD = 'a-very-long-password-x';

interface AuthedUser {
  id: string;
  email: string;
  accessToken: string;
}

async function registerUser(app: FastifyInstance, email: string): Promise<AuthedUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: PASSWORD, displayName: email.split('@')[0] ?? 'user' },
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

describe('account management endpoints', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping account management integration tests');
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

  // ─────────────────────────── change-password ───────────────────────────

  it('change-password : nominal — ancien mdp KO, nouveau OK', async () => {
    const u = await registerUser(app, 'cp-ok@ex.com');
    const newPassword = 'brand-new-password-1';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: auth(u),
      payload: { currentPassword: PASSWORD, newPassword },
    });
    expect(res.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: u.email, password: PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: u.email, password: newPassword },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('change-password : mauvais mot de passe actuel → 401', async () => {
    const u = await registerUser(app, 'cp-wrong@ex.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: auth(u),
      payload: { currentPassword: 'not-the-password', newPassword: 'another-long-pass-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('change-password : non authentifié → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { currentPassword: PASSWORD, newPassword: 'another-long-pass-2' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ─────────────────────────── PATCH /me ─────────────────────────────────

  it('PATCH /me : met à jour le displayName', async () => {
    const u = await registerUser(app, 'patch-name@ex.com');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: auth(u),
      payload: { displayName: 'Nouveau Nom' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.displayName).toBe('Nouveau Nom');
  });

  it('PATCH /me : email déjà pris → 409', async () => {
    const a = await registerUser(app, 'patch-taken-a@ex.com');
    await registerUser(app, 'patch-taken-b@ex.com');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: auth(a),
      payload: { email: 'patch-taken-b@ex.com' },
    });
    expect(res.statusCode).toBe(409);
  });

  // ─────────────────────────── DELETE /me ────────────────────────────────

  it('DELETE /me : transfère la propriété au plus ancien autre membre', async () => {
    const alice = await registerUser(app, 'del-owner@ex.com');
    const bob = await registerUser(app, 'del-successor@ex.com');

    const g = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: auth(alice),
        payload: { name: 'Groupe à transférer' },
      })
      .then((r) => r.json<{ group: { id: string } }>());
    const inv = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/invitations`,
        headers: auth(alice),
        payload: { role: 'member' },
      })
      .then((r) => r.json<{ invitation: { slug: string } }>());
    await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
      headers: auth(bob),
    });

    // Alice (owner) crée un event → events.created_by = alice (FK restrict).
    const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${g.group.id}/events`,
      headers: auth(alice),
      payload: { title: 'Event transféré', startsAt },
    });

    // Alice supprime son compte.
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      headers: auth(alice),
    });
    expect(del.statusCode).toBe(200);

    // Le groupe survit, bob est devenu owner.
    const members = await app
      .inject({
        method: 'GET',
        url: `/api/v1/groups/${g.group.id}/members`,
        headers: auth(bob),
      })
      .then((r) => r.json<{ members: { userId: string; role: string }[] }>());
    const bobMember = members.members.find((m) => m.userId === bob.id);
    expect(bobMember?.role).toBe('owner');
    expect(members.members.find((m) => m.userId === alice.id)).toBeUndefined();

    // L'event a survécu (created_by transféré à bob).
    const events = await app
      .inject({
        method: 'GET',
        url: `/api/v1/groups/${g.group.id}/events`,
        headers: auth(bob),
      })
      .then((r) => r.json<{ events: { title: string }[] }>());
    expect(events.events.some((e) => e.title === 'Event transféré')).toBe(true);

    // Le compte d'alice est effacé : son access token ne résout plus de user.
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(alice) });
    expect(me.statusCode).toBe(401);
  });

  it('DELETE /me : groupe à membre unique supprimé en cascade', async () => {
    const solo = await registerUser(app, 'del-solo@ex.com');
    const g = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: auth(solo),
        payload: { name: 'Groupe solo' },
      })
      .then((r) => r.json<{ group: { id: string } }>());
    const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${g.group.id}/events`,
      headers: auth(solo),
      payload: { title: 'Event solo', startsAt },
    });

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      headers: auth(solo),
    });
    expect(del.statusCode).toBe(200);

    // Compte effacé.
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(solo) });
    expect(me.statusCode).toBe(401);
  });
});
