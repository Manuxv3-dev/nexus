/**
 * Ce qu'un départ de membre laisse derrière lui (cf. ticket 2f422033).
 *
 * `removeMember` ne supprime que la ligne `group_members` : les tables pivot
 * (`event_rsvps`, `poll_votes`, `todo_items.assignee_id`, `expense_shares`)
 * ne référencent pas la membership et survivent donc au départ. Le ticket
 * `7a909304` a fermé la fuite en LECTURE ; ces lignes-là restent, et se voient
 * chez les membres restants — un « 5 oui » qui compte un absent, un todo
 * affiché comme assigné à un fragment d'UUID.
 *
 * L'arbitrage retenu est délibérément différent selon la nature du pivot, et
 * ce fichier l'encode :
 *
 * | Pivot | Traitement | Pourquoi |
 * | --- | --- | --- |
 * | `todo_items.assignee_id` | remis à NULL en écriture | un absent ne peut pas faire la tâche, et l'assignation n'a aucune valeur historique |
 * | `event_rsvps`, `poll_votes` | filtrés à la lecture | pas d'écriture destructive : le décompte d'un event passé n'est pas réécrit, et une ré-invitation restaure tout |
 * | `expense_shares` | **intacte** | ce n'est pas une donnée périmée, c'est de l'argent dû ; l'effacer ferait disparaître une créance |
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

describe('départ de membre — ce qui reste derrière', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping member departure tests');
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

  it('le RSVP d’un ex-membre ne compte plus dans l’événement', async () => {
    const alice = await registerUser('dep-rsvp-alice@ex.com');
    const bob = await registerUser('dep-rsvp-bob@ex.com');
    const groupId = await makeGroup(alice, 'Depart RSVP');
    await joinGroup(alice, groupId, bob);

    const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const ev = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/events`,
        headers: auth(alice),
        payload: { title: 'Randonnée', startsAt },
      })
      .then((r) => r.json<{ event: { id: string } }>());
    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${ev.event.id}/rsvp`,
      headers: auth(bob),
      payload: { value: 'yes' },
    });

    // Pré-condition : tant qu'il est membre, Bob compte bien.
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${ev.event.id}`,
      headers: auth(alice),
    });
    expect(
      before.json<{ event: { rsvps: { userId: string }[] } }>().event.rsvps.map((r) => r.userId),
    ).toContain(bob.id);

    await leaveGroup(bob, groupId);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${ev.event.id}`,
      headers: auth(alice),
    });
    expect(after.statusCode).toBe(200);
    expect(
      after.json<{ event: { rsvps: { userId: string }[] } }>().event.rsvps.map((r) => r.userId),
    ).not.toContain(bob.id);
  });

  it('le RSVP d’un ex-membre ne compte plus dans la liste des événements du groupe', async () => {
    // Chemin de lecture distinct de celui du test précédent (hydratation bulk,
    // pas unitaire) : c'est lui qui alimente la vue Événements du groupe.
    const alice = await registerUser('dep-rsvp-list-alice@ex.com');
    const bob = await registerUser('dep-rsvp-list-bob@ex.com');
    const groupId = await makeGroup(alice, 'Depart RSVP liste');
    await joinGroup(alice, groupId, bob);

    const startsAt = new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString();
    const ev = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/events`,
        headers: auth(alice),
        payload: { title: 'Cinéma', startsAt },
      })
      .then((r) => r.json<{ event: { id: string } }>());
    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${ev.event.id}/rsvp`,
      headers: auth(bob),
      payload: { value: 'yes' },
    });

    await leaveGroup(bob, groupId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/events`,
      headers: auth(alice),
    });
    expect(res.statusCode).toBe(200);
    const found = res
      .json<{ events: { id: string; rsvps: { userId: string }[] }[] }>()
      .events.find((e) => e.id === ev.event.id);
    expect(found?.rsvps.map((r) => r.userId)).not.toContain(bob.id);
  });

  it('le vote d’un ex-membre ne compte plus dans le sondage', async () => {
    const alice = await registerUser('dep-poll-alice@ex.com');
    const bob = await registerUser('dep-poll-bob@ex.com');
    const groupId = await makeGroup(alice, 'Depart sondage');
    await joinGroup(alice, groupId, bob);

    const poll = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/polls`,
        headers: auth(alice),
        payload: { question: 'On part quand ?', multi: false, options: ['Juin', 'Juillet'] },
      })
      .then((r) => r.json<{ poll: { id: string; options: { id: string }[] } }>());
    const optionId = poll.poll.options[0]?.id;
    expect(optionId).toBeDefined();
    const vote = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${poll.poll.id}/vote`,
      headers: auth(bob),
      payload: { optionId, value: true },
    });
    expect(vote.statusCode).toBe(200);

    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/polls/${poll.poll.id}`,
      headers: auth(alice),
    });
    expect(
      before
        .json<{ poll: { options: { voters: string[] }[] } }>()
        .poll.options.flatMap((o) => o.voters),
    ).toContain(bob.id);

    await leaveGroup(bob, groupId);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/polls/${poll.poll.id}`,
      headers: auth(alice),
    });
    expect(after.statusCode).toBe(200);
    expect(
      after
        .json<{ poll: { options: { voters: string[] }[] } }>()
        .poll.options.flatMap((o) => o.voters),
    ).not.toContain(bob.id);
  });

  it('le todo assigné à un ex-membre redevient non assigné', async () => {
    // Le seul des quatre pivots traité en ÉCRITURE : une tâche assignée à
    // quelqu'un qui n'est plus là n'a personne pour la faire, et l'affichage
    // tombait sur `assigneeId.slice(0, 8)` faute de nom résolvable — un
    // fragment d'UUID dans l'UI.
    const alice = await registerUser('dep-todo-alice@ex.com');
    const bob = await registerUser('dep-todo-bob@ex.com');
    const groupId = await makeGroup(alice, 'Depart todo');
    await joinGroup(alice, groupId, bob);

    const list = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/todo-lists`,
        headers: auth(alice),
        payload: { title: 'Préparatifs' },
      })
      .then((r) => r.json<{ todoList: { id: string } }>());
    const item = await app
      .inject({
        method: 'POST',
        url: `/api/v1/todo-lists/${list.todoList.id}/items`,
        headers: auth(alice),
        payload: { text: 'Réserver le gîte', assigneeId: bob.id },
      })
      .then((r) => r.json<{ todoItem: { id: string } }>());

    await leaveGroup(bob, groupId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/todo-lists/${list.todoList.id}`,
      headers: auth(alice),
    });
    expect(res.statusCode).toBe(200);
    const found = res
      .json<{ todoList: { items: { id: string; assigneeId: string | null }[] } }>()
      .todoList.items.find((i) => i.id === item.todoItem.id);
    expect(found?.assigneeId).toBeNull();
  });

  it("la part de dépense d'un ex-membre reste intacte — c'est de l'argent dû", async () => {
    // Non-régression volontaire, et le pendant des trois tests ci-dessus : on
    // NE nettoie PAS ce pivot-là. Supprimer la part ferait disparaître la
    // créance d'Alice sans qu'elle l'ait décidé. Si quelqu'un généralise un
    // jour la purge aux quatre pivots, c'est ce test qui doit l'arrêter.
    const alice = await registerUser('dep-exp-alice@ex.com');
    const bob = await registerUser('dep-exp-bob@ex.com');
    const groupId = await makeGroup(alice, 'Depart depense');
    await joinGroup(alice, groupId, bob);

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

    await leaveGroup(bob, groupId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/expenses/${expenseId}`,
      headers: auth(alice),
    });
    expect(res.statusCode).toBe(200);
    const shares = res.json<{
      expense: { shares: { userId: string; shareCents: number; isSettled: boolean }[] };
    }>().expense.shares;
    const bobShare = shares.find((s) => s.userId === bob.id);
    expect(bobShare?.shareCents).toBe(2000);
    expect(bobShare?.isSettled).toBe(false);
  });
});
