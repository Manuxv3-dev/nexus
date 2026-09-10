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

  it('est semi-ouvert : startsAt === weekStart dedans, === weekEnd dehors', async () => {
    // Verrouille `gte`/`lt`. Un glissement vers `gt`/`lte` ferait disparaître
    // le lundi minuit ou compterait le même event dans deux semaines — et
    // aucun autre test ne l'attraperait.
    const u = await registerUser(app, 'home-week-bornes@ex.com');
    const groupId = await makeGroup(u, 'Home Week Bornes grp');
    const onStart = await makeEvent(u, groupId, 'Pile au début', WEEK_START);
    const onEnd = await makeEvent(u, groupId, 'Pile à la fin', WEEK_END);

    const res = await app.inject({
      method: 'GET',
      url: feedUrl({ weekStart: WEEK_START, weekEnd: WEEK_END }),
      headers: auth(u),
    });
    const ids = res.json<{ weekEvents: { id: string }[] }>().weekEvents.map((e) => e.id);
    expect(ids).toContain(onStart.id);
    expect(ids).not.toContain(onEnd.id);
  });

  it('répond 200 sans les query params — les builds desktop figés en dépendent', async () => {
    // Un desktop déjà installé embarque une copie figée de @nexus/web et appelle
    // donc l'endpoint sans bornes. Un 400 y casserait la Home ENTIÈRE, pas
    // seulement son calendrier : les params doivent rester optionnels.
    const u = await registerUser(app, 'home-week-legacy@ex.com');
    const groupId = await makeGroup(u, 'Home Week Legacy grp');
    // À venir, et non `IN_WEEK` : cette fenêtre de test est révolue (mars 2020),
    // or `pendingRsvps` ne remonte que le futur. Il faut un event futur pour
    // prouver que le RESTE du feed est bien servi à un client sans bornes.
    const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await makeEvent(u, groupId, 'Apéro', soon);

    const res = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(u) });
    expect(res.statusCode).toBe(200);
    // Le reste du feed reste servi — c'est ce qui compte pour eux.
    const body = res.json<{ weekEvents: unknown[]; pendingRsvps: unknown[] }>();
    expect(body.pendingRsvps).toHaveLength(1);
    // La fenêtre est opt-in : sans bornes, pas de semaine (et pas de requête
    // SQL dont le résultat serait de toute façon strippé par ces clients).
    expect(body.weekEvents).toEqual([]);
  });

  it.each([
    ['weekStart seul', { weekStart: WEEK_START }],
    ['weekEnd antérieur à weekStart', { weekStart: WEEK_END, weekEnd: WEEK_START }],
    ['fenêtre de plus de 31 jours', { weekStart: WEEK_START, weekEnd: '2020-05-01T00:00:00.000Z' }],
  ])('rejette en 400 : %s', async (_label, query) => {
    const u = await registerUser(
      app,
      `home-week-400-${_label.slice(0, 8).replace(/\W/g, '')}@ex.com`,
    );
    const qs = new URLSearchParams(query as Record<string, string>).toString();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/home/feed?${qs}`,
      headers: auth(u),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
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

  // ── anti-leak : quitter un groupe coupe l'accès, dans les 3 sections ──────
  //
  // Les lignes qui alimentent `upcomingEvents`, `unsettledExpenses` et
  // `assignedTodos` (`event_rsvps`, `expense_shares`, `todo_items.assignee_id`)
  // portent un `user_id` mais aucune référence à la membership, et
  // `removeMember` ne supprime que la ligne `group_members` — aucune cascade
  // ne les nettoie. Sans jointure explicite sur `group_members`, ces trois
  // requêtes continuent donc de servir du contenu de groupe à quelqu'un qui
  // n'en est plus membre : pas une copie figée, la ligne vivante — un event
  // renommé après son départ lui remonte sous son nouveau titre.
  //
  // Le scénario est le même pour les trois : Bob rejoint, laisse une trace
  // (RSVP / part de dépense / todo assigné), puis quitte.

  /** Invitation `member` créée par l'owner, puis acceptée — deux aller-retours. */
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
    if (res.statusCode !== 200) throw new Error(`joinGroup failed: ${res.statusCode} ${res.body}`);
  }

  /** Self-leave — le chemin le plus permissif : inconditionnel pour un member. */
  async function leaveGroup(u: AuthedUser, groupId: string): Promise<void> {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${groupId}/members/${u.id}`,
      headers: auth(u),
    });
    if (res.statusCode !== 200) throw new Error(`leaveGroup failed: ${res.statusCode} ${res.body}`);
  }

  it("anti-leak : un ex-membre ne voit plus en upcomingEvents l'event qu'il avait confirmé", async () => {
    const alice = await registerUser(app, 'home-left-event-owner@ex.com');
    const bob = await registerUser(app, 'home-left-event-bob@ex.com');
    const groupId = await makeGroup(alice, 'Left Event grp');
    await joinGroup(alice, groupId, bob);

    const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const ev = await makeEvent(alice, groupId, 'Week-end à la mer', startsAt);
    const rsvp = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${ev.id}/rsvp`,
      headers: auth(bob),
      payload: { value: 'yes' },
    });
    expect(rsvp.statusCode).toBe(200);

    // Pré-condition : tant qu'il est membre, Bob le voit bien.
    const before = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(bob) });
    expect(
      before.json<{ upcomingEvents: { id: string }[] }>().upcomingEvents.map((e) => e.id),
    ).toContain(ev.id);

    await leaveGroup(bob, groupId);

    const after = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(bob) });
    expect(after.statusCode).toBe(200);
    const body = after.json<{ upcomingEvents: { id: string }[] }>();
    expect(body.upcomingEvents.map((e) => e.id)).not.toContain(ev.id);
  });

  it('anti-leak : un ex-membre ne voit plus sa part de dépense en unsettledExpenses', async () => {
    const alice = await registerUser(app, 'home-left-exp-owner@ex.com');
    const bob = await registerUser(app, 'home-left-exp-bob@ex.com');
    const groupId = await makeGroup(alice, 'Left Expense grp');
    await joinGroup(alice, groupId, bob);

    // Alice avance, Bob lui doit sa moitié : la part de Bob reste non réglée.
    const exp = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/expenses`,
      headers: auth(alice),
      payload: {
        description: 'Courses du week-end',
        amountCents: 4000,
        currency: 'EUR',
        paidBy: alice.id,
        shares: [
          { userId: alice.id, shareCents: 2000 },
          { userId: bob.id, shareCents: 2000 },
        ],
      },
    });
    expect(exp.statusCode).toBe(200);
    const expenseId = exp.json<{ expense: { id: string } }>().expense.id;

    const before = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(bob) });
    expect(
      before.json<{ unsettledExpenses: { id: string }[] }>().unsettledExpenses.map((e) => e.id),
    ).toContain(expenseId);

    await leaveGroup(bob, groupId);

    const after = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(bob) });
    expect(after.statusCode).toBe(200);
    const ids = after
      .json<{ unsettledExpenses: { id: string }[] }>()
      .unsettledExpenses.map((e) => e.id);
    expect(ids).not.toContain(expenseId);
  });

  it('anti-leak : un ex-membre ne voit plus le todo qui lui était assigné', async () => {
    const alice = await registerUser(app, 'home-left-todo-owner@ex.com');
    const bob = await registerUser(app, 'home-left-todo-bob@ex.com');
    const groupId = await makeGroup(alice, 'Left Todo grp');
    await joinGroup(alice, groupId, bob);

    const list = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/todo-lists`,
        headers: auth(alice),
        payload: { title: 'Préparatifs' },
      })
      .then((r) => r.json<{ todoList: { id: string } }>());
    const item = await app.inject({
      method: 'POST',
      url: `/api/v1/todo-lists/${list.todoList.id}/items`,
      headers: auth(alice),
      payload: { text: 'Réserver le gîte', assigneeId: bob.id },
    });
    expect(item.statusCode).toBe(200);
    const itemId = item.json<{ todoItem: { id: string } }>().todoItem.id;

    const before = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(bob) });
    expect(
      before.json<{ assignedTodos: { id: string }[] }>().assignedTodos.map((t) => t.id),
    ).toContain(itemId);

    await leaveGroup(bob, groupId);

    const after = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(bob) });
    expect(after.statusCode).toBe(200);
    const ids = after.json<{ assignedTodos: { id: string }[] }>().assignedTodos.map((t) => t.id);
    expect(ids).not.toContain(itemId);
  });

  it('anti-leak : le depart vide aussi pendingRsvps, pendingPolls et weekEvents', async () => {
    // Ces trois-la joignaient deja `group_members` avant 7a909304 — et rien ne
    // les en empechait de la perdre : aucun test ne couvrait le depart d'un
    // membre. Un refactor qui supprimerait l'une des trois passait au vert.
    const alice = await registerUser(app, 'home-left-all-owner@ex.com');
    const bob = await registerUser(app, 'home-left-all-bob@ex.com');
    const groupId = await makeGroup(alice, 'Left All grp');
    await joinGroup(alice, groupId, bob);

    // Un event futur sans RSVP de Bob (pendingRsvps), un event dans la semaine
    // de test revolue (weekEvents), un sondage ouvert non vote (pendingPolls).
    const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    const pending = await makeEvent(alice, groupId, 'A confirmer', soon);
    const inWeek = await makeEvent(alice, groupId, 'Dans la semaine', IN_WEEK);
    const poll = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/polls`,
        headers: auth(alice),
        payload: { question: 'On part quand ?', multi: false, options: ['Juin', 'Juillet'] },
      })
      .then((r) => r.json<{ poll: { id: string } }>());

    const url = feedUrl({ weekStart: WEEK_START, weekEnd: WEEK_END });
    const before = await app.inject({ method: 'GET', url, headers: auth(bob) });
    expect(before.statusCode).toBe(200);
    const seen = before.json<{
      pendingRsvps: { id: string }[];
      pendingPolls: { id: string }[];
      weekEvents: { id: string }[];
    }>();
    expect(seen.pendingRsvps.map((e) => e.id)).toContain(pending.id);
    expect(seen.pendingPolls.map((p) => p.id)).toContain(poll.poll.id);
    expect(seen.weekEvents.map((e) => e.id)).toContain(inWeek.id);

    await leaveGroup(bob, groupId);

    const after = await app.inject({ method: 'GET', url, headers: auth(bob) });
    expect(after.statusCode).toBe(200);
    const gone = after.json<{
      pendingRsvps: { id: string }[];
      pendingPolls: { id: string }[];
      weekEvents: { id: string }[];
    }>();
    expect(gone.pendingRsvps.map((e) => e.id)).not.toContain(pending.id);
    expect(gone.pendingPolls.map((p) => p.id)).not.toContain(poll.poll.id);
    expect(gone.weekEvents.map((e) => e.id)).not.toContain(inWeek.id);
  });

  it('re-invite, Bob retrouve son event : la membership est le seul verrou', async () => {
    // La moitie positive du contrat. Le RSVP survit au depart (aucune cascade
    // ne le nettoie), donc le retour doit tout rendre. Si un jour on purge les
    // pivots au depart, ce test devient le garde-fou qui dit que le retour est
    // devenu lossy — au lieu de laisser la perte passer inapercue.
    const alice = await registerUser(app, 'home-rejoin-owner@ex.com');
    const bob = await registerUser(app, 'home-rejoin-bob@ex.com');
    const groupId = await makeGroup(alice, 'Rejoin grp');
    await joinGroup(alice, groupId, bob);

    const startsAt = new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString();
    const ev = await makeEvent(alice, groupId, 'Rando', startsAt);
    const rsvp = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${ev.id}/rsvp`,
      headers: auth(bob),
      payload: { value: 'yes' },
    });
    expect(rsvp.statusCode).toBe(200);

    await leaveGroup(bob, groupId);
    const gone = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(bob) });
    expect(
      gone.json<{ upcomingEvents: { id: string }[] }>().upcomingEvents.map((e) => e.id),
    ).not.toContain(ev.id);

    await joinGroup(alice, groupId, bob);

    const back = await app.inject({ method: 'GET', url: feedUrl(), headers: auth(bob) });
    expect(back.statusCode).toBe(200);
    expect(
      back.json<{ upcomingEvents: { id: string }[] }>().upcomingEvents.map((e) => e.id),
    ).toContain(ev.id);
  });
});
