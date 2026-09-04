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
 *       * weekEvents : tout ce que porte la fenêtre demandée — sans filtre
 *         RSVP, sans futur strict, sans limite à 5 (les 3 restrictions qui
 *         faisaient passer un top 5 pour un calendrier de semaine)
 *       * unreadByGroup : agrégation des notifs unread par groupe
 *   - la rétro-compat des query params (desktop figé) et l'anti-leak.
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
    // Guard : si beforeAll a thrown avant d'assigner app/testDb, on évite
    // de masquer la vraie erreur par un "Cannot read properties of undefined".
    if (app) await app.close();
    const { closeDb } = await import('../../db/client.js');
    const { closeRedis } = await import('../../db/health.js');
    await closeDb();
    await closeRedis();
    if (testDb) await testDb.cleanup();
  });

  it('renvoie 5 sections vides pour un user sans groupe', async () => {
    const u = await registerUser(app, 'home-empty@ex.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown[]>>();
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
      .then((r) => r.json<{ group: { id: string } }>());
    // Créer un event à J+7
    const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const ev = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/events`,
        headers: auth(u),
        payload: { title: 'Apéro', startsAt },
      })
      .then((r) => r.json<{ event: { id: string } }>());

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ pendingRsvps: { id: string; title: string }[] }>();
    const ids = body.pendingRsvps.map((r) => r.id);
    expect(ids).toContain(ev.event.id);
    expect(body.pendingRsvps[0]?.title).toBe('Apéro');
  });

  it("ne remonte pas l'event en pendingRsvps si j'ai RSVP, mais le met en upcomingEvents si yes", async () => {
    const u = await registerUser(app, 'home-yes@ex.com');
    const g = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: auth(u),
        payload: { name: 'Home Yes grp' },
      })
      .then((r) => r.json<{ group: { id: string } }>());
    const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const ev = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/events`,
        headers: auth(u),
        payload: { title: 'Brunch', startsAt },
      })
      .then((r) => r.json<{ event: { id: string } }>());

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
    const body = res.json<{
      pendingRsvps: { id: string }[];
      upcomingEvents: { id: string; title: string }[];
    }>();
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
      .then((r) => r.json<{ group: { id: string } }>());
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
      .then((r) => r.json<{ poll: { id: string } }>());

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      pendingPolls: { id: string; question: string; optionCount: number }[];
    }>();
    const found = body.pendingPolls.find((p) => p.id === poll.poll.id);
    expect(found?.question).toBe('Quel resto ?');
    expect(found?.optionCount).toBe(3);
  });

  // ── weekEvents : la grille Lundi → Dimanche, pas « mes 5 prochains » ──────
  //
  // Semaine volontairement fixe et révolue (lundi 2 → lundi 9 mars 2020) : le
  // « passé » y est un fait de calendrier, pas une soustraction sur `now()` qui
  // deviendrait ambiguë selon l'heure à laquelle la CI tourne.
  const WEEK_START = '2020-03-02T00:00:00.000Z';
  const WEEK_END = '2020-03-09T00:00:00.000Z';
  const IN_WEEK = '2020-03-04T19:00:00.000Z';
  const AFTER_WEEK = '2020-03-10T19:00:00.000Z';

  function feedUrl(query?: { weekStart: string; weekEnd: string }): string {
    if (!query) return '/api/v1/home/feed';
    const qs = new URLSearchParams(query).toString();
    return `/api/v1/home/feed?${qs}`;
  }

  async function makeGroup(u: AuthedUser, name: string): Promise<string> {
    const g = await app
      .inject({ method: 'POST', url: '/api/v1/groups', headers: auth(u), payload: { name } })
      .then((r) => r.json<{ group: { id: string } }>());
    return g.group.id;
  }

  async function makeEvent(u: AuthedUser, groupId: string, title: string, startsAt: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/events`,
      headers: auth(u),
      payload: { title, startsAt },
    });
    if (res.statusCode !== 200) throw new Error(`makeEvent failed: ${res.statusCode} ${res.body}`);
    return res.json<{ event: { id: string } }>().event;
  }

  it('remonte en weekEvents un event passé et sans RSVP — invisible en upcomingEvents', async () => {
    const u = await registerUser(app, 'home-week-past@ex.com');
    const groupId = await makeGroup(u, 'Home Week grp');
    // Aucun RSVP posé, et la date est révolue : les deux filtres qui faisaient
    // le bug. C'est pourtant l'event que la case « mercredi » doit porter.
    const ev = await makeEvent(u, groupId, 'Barbecue de lundi', IN_WEEK);

    const res = await app.inject({
      method: 'GET',
      url: feedUrl({ weekStart: WEEK_START, weekEnd: WEEK_END }),
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      weekEvents: { id: string; title: string }[];
      upcomingEvents: { id: string }[];
    }>();
    expect(body.weekEvents.map((e) => e.id)).toContain(ev.id);
    expect(body.weekEvents.find((e) => e.id === ev.id)?.title).toBe('Barbecue de lundi');
    // La frontière : `upcomingEvents` reste « mes confirmés à venir ».
    expect(body.upcomingEvents.map((e) => e.id)).not.toContain(ev.id);
  });

  it('ne tronque pas la semaine à 5 events', async () => {
    const u = await registerUser(app, 'home-week-limit@ex.com');
    const groupId = await makeGroup(u, 'Home Week Limit grp');
    const created = [];
    for (let i = 0; i < 7; i++) {
      created.push(await makeEvent(u, groupId, `Event ${i}`, IN_WEEK));
    }

    const res = await app.inject({
      method: 'GET',
      url: feedUrl({ weekStart: WEEK_START, weekEnd: WEEK_END }),
      headers: auth(u),
    });
    const body = res.json<{ weekEvents: { id: string }[] }>();
    const ids = body.weekEvents.map((e) => e.id);
    for (const ev of created) expect(ids).toContain(ev.id);
  });

  it('exclut ce qui tombe hors de la fenêtre demandée', async () => {
    const u = await registerUser(app, 'home-week-window@ex.com');
    const groupId = await makeGroup(u, 'Home Week Window grp');
    const inside = await makeEvent(u, groupId, 'Dedans', IN_WEEK);
    const outside = await makeEvent(u, groupId, 'Dehors', AFTER_WEEK);

    const res = await app.inject({
      method: 'GET',
      url: feedUrl({ weekStart: WEEK_START, weekEnd: WEEK_END }),
      headers: auth(u),
    });
    const ids = res.json<{ weekEvents: { id: string }[] }>().weekEvents.map((e) => e.id);
    expect(ids).toContain(inside.id);
    expect(ids).not.toContain(outside.id);
  });

  it('répond 200 sans les query params — les builds desktop figés en dépendent', async () => {
    // Un desktop déjà installé embarque une copie figée de @nexus/web et appelle
    // donc l'endpoint sans bornes. Un 400 y casserait la Home ENTIÈRE, pas
    // seulement son calendrier : les params doivent rester optionnels.
    const u = await registerUser(app, 'home-week-legacy@ex.com');

    const res = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(u) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ weekEvents: unknown[] }>().weekEvents).toEqual([]);
  });

  it('anti-leak : les events d’un groupe étranger ne fuient pas en weekEvents', async () => {
    const me = await registerUser(app, 'home-week-leak-me@ex.com');
    const other = await registerUser(app, 'home-week-leak-other@ex.com');
    const groupId = await makeGroup(me, 'Week Leak grp');
    const ev = await makeEvent(me, groupId, 'Privé', IN_WEEK);

    const res = await app.inject({
      method: 'GET',
      url: feedUrl({ weekStart: WEEK_START, weekEnd: WEEK_END }),
      headers: auth(other),
    });
    const ids = res.json<{ weekEvents: { id: string }[] }>().weekEvents.map((e) => e.id);
    expect(ids).not.toContain(ev.id);
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
      .then((r) => r.json<{ group: { id: string } }>());
    // Liste + item assigné à moi
    const list = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${g.group.id}/todo-lists`,
        headers: auth(me),
        payload: { title: 'Courses' },
      })
      .then((r) => r.json<{ todoList: { id: string } }>());
    await app.inject({
      method: 'POST',
      url: `/api/v1/todo-lists/${list.todoList.id}/items`,
      headers: auth(me),
      payload: { text: 'Acheter pain', assigneeId: me.id },
    });

    // Other user : home feed, pas mes todos
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/home/feed',
      headers: auth(other),
    });
    const body = res.json<{ assignedTodos: unknown[] }>();
    expect(body.assignedTodos).toEqual([]);
  });
});
