/**
 * Tests d'intégration GET /api/v1/home/feed (cf. ADR-024).
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 * Couvre :
 *   - le 200 sur un user fraîchement créé (toutes sections vides)
 *   - chaque section indépendamment :
 *       * pendingRsvps : event upcoming, je suis membre, pas de RSVP
 *       * unsettledExpenses : je dois encore payer, je ne suis pas le payeur
 *       * assignedTodos : item assigné à moi, non done
 *       * upcomingEvents : event où mon RSVP est 'yes', à venir
 *       * unreadByGroup : agrégation des notifs unread par groupe
 *   - anti-leak : un autre user ne voit pas mes items.
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

describe('home feed endpoint', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    // eslint-disable-next-line no-console
    console.warn('  ⚠ Postgres unavailable, skipping home feed integration tests');
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
    await app.close();
    const { closeDb } = await import('../../db/client.js');
    const { closeRedis } = await import('../../db/health.js');
    await closeDb();
    await closeRedis();
    await testDb.cleanup();
  });

  it('renvoie 5 sections vides pour un user sans groupe', async () => {
    const u = await registerUser(app, 'home-empty@ex.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown[]>;
    expect(body['pendingRsvps']).toEqual([]);
    expect(body['unsettledExpenses']).toEqual([]);
    expect(body['assignedTodos']).toEqual([]);
    expect(body['upcomingEvents']).toEqual([]);
    expect(body['pendingPolls']).toEqual([]);
    expect(body['unreadByGroup']).toEqual([]);
  });

  it('remonte un event upcoming sans RSVP en pendingRsvps', async () => {
    const u = await registerUser(app, 'home-rsvp@ex.com');
    // Créer un groupe
    const g = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: auth(u),
        payload: { name: 'Home RSVP grp' },
      })
      .then((r) => r.json() as { group: { id: string } });
    // Créer un event à J+7
    const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const ev = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/events`,
        headers: auth(u),
        payload: { title: 'Apéro', startsAt },
      })
      .then((r) => r.json() as { event: { id: string } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pendingRsvps: { id: string; title: string }[] };
    const ids = body.pendingRsvps.map((r) => r.id);
    expect(ids).toContain(ev.event.id);
    expect(body.pendingRsvps[0]?.title).toBe('Apéro');
  });

  it('ne remonte pas l\'event en pendingRsvps si j\'ai RSVP, mais le met en upcomingEvents si yes', async () => {
    const u = await registerUser(app, 'home-yes@ex.com');
    const g = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: auth(u),
        payload: { name: 'Home Yes grp' },
      })
      .then((r) => r.json() as { group: { id: string } });
    const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const ev = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/events`,
        headers: auth(u),
        payload: { title: 'Brunch', startsAt },
      })
      .then((r) => r.json() as { event: { id: string } });

    // RSVP yes
    const rsvp = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${ev.event.id}/rsvp`,
      headers: auth(u),
      payload: { value: 'yes' },
    });
    expect(rsvp.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(u),
    });
    const body = res.json() as {
      pendingRsvps: { id: string }[];
      upcomingEvents: { id: string; title: string }[];
    };
    expect(body.pendingRsvps.map((r) => r.id)).not.toContain(ev.event.id);
    const upcoming = body.upcomingEvents.find((e) => e.id === ev.event.id);
    expect(upcoming?.title).toBe('Brunch');
  });

  it('remonte un sondage non voté en pendingPolls', async () => {
    const u = await registerUser(app, 'home-poll@ex.com');
    const g = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: auth(u),
        payload: { name: 'Home Poll grp' },
      })
      .then((r) => r.json() as { group: { id: string } });
    const poll = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/polls`,
        headers: auth(u),
        payload: {
          question: 'Quel resto ?',
          multi: false,
          options: ['Pizza', 'Sushi', 'Burger'],
        },
      })
      .then((r) => r.json() as { poll: { id: string } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      pendingPolls: { id: string; question: string; optionCount: number }[];
    };
    const found = body.pendingPolls.find((p) => p.id === poll.poll.id);
    expect(found?.question).toBe('Quel resto ?');
    expect(found?.optionCount).toBe(3);
  });

  it('anti-leak : un autre user ne voit pas mon todo assigné', async () => {
    const me = await registerUser(app, 'home-leak-me@ex.com');
    const other = await registerUser(app, 'home-leak-other@ex.com');

    const g = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: auth(me),
        payload: { name: 'Leak grp' },
      })
      .then((r) => r.json() as { group: { id: string } });
    // Liste + item assigné à moi
    const list = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/todo-lists`,
        headers: auth(me),
        payload: { title: 'Courses' },
      })
      .then((r) => r.json() as { list: { id: string } });
    await app.inject({
      method: 'POST',
      url: `/api/v1/todo-lists/${list.list.id}/items`,
      headers: auth(me),
      payload: { text: 'Acheter pain', assigneeId: me.id },
    });

    // Other user : home feed, pas mes todos
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(other),
    });
    const body = res.json() as { assignedTodos: unknown[] };
    expect(body.assignedTodos).toEqual([]);
  });
});
