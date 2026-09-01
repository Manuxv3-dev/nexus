/**
 * MAN-246 point 6 — qui a le droit de modifier le contenu d'un autre.
 *
 * Le ticket décrivait une UI trop stricte face à un serveur correct. La lecture
 * des routes disait l'inverse : `PATCH /events/:id`, `/polls/:id` et
 * `/todo-lists/:id` ne vérifiaient que `findMembership`. N'importe quel membre
 * du groupe pouvait donc réécrire le titre, la date et le lieu de l'événement
 * d'un autre — silencieusement, sans trace autre que le `updatedAt`.
 *
 * Les trois routes s'alignent désormais sur leur propre `DELETE`, et sur ce que
 * `expenses` faisait déjà des deux côtés : créateur, ou owner/admin du groupe.
 *
 * Fichier transverse plutôt que trois blocs dans trois fichiers de route : la
 * règle est **une seule**, et c'est sa cohérence entre les trois surfaces qui
 * doit être verrouillée. Éclatée, une divergence future passerait inaperçue.
 *
 * Hors périmètre, volontairement non testé ici : `PATCH /todo-items/:itemId`
 * reste ouvert à tout membre (cocher une tâche assignée est une action de
 * membre, pas une édition de contenu) et le RSVP d'`events` a sa propre règle.
 *
 * Skip auto si Postgres n'est pas joignable — cf. `just test-integration`. Un
 * run vert sans base ne prouve rien sur ce fichier.
 */
import type { WsEvent } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../test/db.js';
import { setTestEnv } from '../test/helpers.js';

// Même raison que `groups.test.ts` : on vérifie le contrat HTTP, pas la
// livraison WS bout-en-bout, et on ne veut pas d'un Redis pub/sub réel ici.
vi.mock('../ws/nexus-event-bus.js', () => ({
  publishNexusEvent: (_event: WsEvent): Promise<void> => Promise.resolve(),
}));

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

interface AuthedUser {
  id: string;
  accessToken: string;
}
interface RegisterReply {
  user: { id: string; email: string };
  accessToken: string;
}
interface GroupReply {
  group: { id: string };
}
interface InvitationReply {
  invitation: { slug: string };
}
interface EventReply {
  event: { id: string; title: string };
}
interface PollReply {
  poll: { id: string; question: string };
}
interface TodoListReply {
  todoList: { id: string; title: string };
}

describe('PATCH — créateur ou owner/admin seulement (MAN-246)', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping PATCH authorization tests');
    return;
  }

  let testDb: TestDb;
  let app: FastifyInstance;
  let seq = 0;

  beforeAll(async () => {
    testDb = await setupTestDb(BASE_DB_URL);
    setTestEnv();
    process.env['DATABASE_URL'] = testDb.url;
    const { resetEnvCache } = await import('../core/env.js');
    resetEnvCache();
    const { buildServer } = await import('../server.js');
    app = await buildServer();
  });

  afterAll(async () => {
    if (app) await app.close();
    const { closeDb } = await import('../db/client.js');
    const { closeRedis } = await import('../db/health.js');
    await closeDb();
    await closeRedis();
    if (testDb) await testDb.cleanup();
  });

  async function register(prefix: string): Promise<AuthedUser> {
    seq += 1;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `${prefix}-${seq}@example.com`,
        password: 'a-very-long-password-x',
        displayName: prefix,
      },
    });
    if (res.statusCode !== 200) {
      throw new Error(`register ${prefix} failed: ${res.statusCode} ${res.body}`);
    }
    const body = res.json<RegisterReply>();
    return { id: body.user.id, accessToken: body.accessToken };
  }

  function auth(u: AuthedUser): { authorization: string } {
    return { authorization: `Bearer ${u.accessToken}` };
  }

  async function joinGroup(
    groupId: string,
    owner: AuthedUser,
    joiner: AuthedUser,
    role: 'member' | 'admin',
  ): Promise<void> {
    const inv = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/invitations`,
        headers: auth(owner),
        payload: { role },
      })
      .then((r) => r.json<InvitationReply>());
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
      headers: auth(joiner),
    });
    if (accepted.statusCode !== 200) {
      throw new Error(`accept failed: ${accepted.statusCode} ${accepted.body}`);
    }
  }

  /**
   * Un groupe avec les 4 profils qui décident du droit de modifier :
   * l'owner (créateur du groupe), un admin, un membre simple, et l'auteur du
   * contenu — un membre simple lui aussi, pour que « créateur » et « gradé »
   * ne se confondent jamais dans les assertions.
   */
  async function makeGroup(): Promise<{
    groupId: string;
    owner: AuthedUser;
    admin: AuthedUser;
    member: AuthedUser;
    author: AuthedUser;
  }> {
    const owner = await register('owner');
    const admin = await register('admin');
    const member = await register('member');
    const author = await register('author');

    const g = await app
      .inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: auth(owner),
        payload: { name: 'La Bande' },
      })
      .then((r) => r.json<GroupReply>());

    await joinGroup(g.group.id, owner, admin, 'admin');
    await joinGroup(g.group.id, owner, member, 'member');
    await joinGroup(g.group.id, owner, author, 'member');

    return { groupId: g.group.id, owner, admin, member, author };
  }

  describe('events', () => {
    async function createEvent(groupId: string, author: AuthedUser): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/events`,
        headers: auth(author),
        payload: {
          title: 'Apéro',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      });
      return res.json<EventReply>().event.id;
    }

    it('refuse la modification par un membre simple qui n’est pas le créateur', async () => {
      const { groupId, member, author } = await makeGroup();
      const eventId = await createEvent(groupId, author);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}`,
        headers: auth(member),
        payload: { title: 'Détourné' },
      });

      expect(res.statusCode).toBe(403);
      // Et le contenu n'a pas bougé : un 403 qui aurait quand même écrit
      // serait le pire des deux mondes.
      const after = await app
        .inject({ method: 'GET', url: `/api/v1/events/${eventId}`, headers: auth(author) })
        .then((r) => r.json<EventReply>());
      expect(after.event.title).toBe('Apéro');
    });

    it('autorise le créateur', async () => {
      const { groupId, author } = await makeGroup();
      const eventId = await createEvent(groupId, author);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}`,
        headers: auth(author),
        payload: { title: 'Apéro décalé' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<EventReply>().event.title).toBe('Apéro décalé');
    });

    it('autorise un admin qui n’est pas le créateur', async () => {
      const { groupId, admin, author } = await makeGroup();
      const eventId = await createEvent(groupId, author);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}`,
        headers: auth(admin),
        payload: { title: 'Modéré' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('autorise l’owner du groupe qui n’est pas le créateur', async () => {
      const { groupId, owner, author } = await makeGroup();
      const eventId = await createEvent(groupId, author);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}`,
        headers: auth(owner),
        payload: { title: 'Modéré par owner' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('n’a pas régressé sur DELETE — un membre simple reste refusé', async () => {
      const { groupId, member, author } = await makeGroup();
      const eventId = await createEvent(groupId, author);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/events/${eventId}`,
        headers: auth(member),
      });

      expect(res.statusCode).toBe(403);
    });

    it('laisse le RSVP ouvert à tout membre — règle distincte, inchangée', async () => {
      const { groupId, member, author } = await makeGroup();
      const eventId = await createEvent(groupId, author);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/rsvp`,
        headers: auth(member),
        payload: { value: 'yes' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('polls', () => {
    async function createPoll(groupId: string, author: AuthedUser): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/polls`,
        headers: auth(author),
        payload: { question: 'Pizza ou sushi ?', options: ['Pizza', 'Sushi'] },
      });
      return res.json<PollReply>().poll.id;
    }

    it('refuse la modification par un membre simple qui n’est pas le créateur', async () => {
      const { groupId, member, author } = await makeGroup();
      const pollId = await createPoll(groupId, author);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/polls/${pollId}`,
        headers: auth(member),
        payload: { question: 'Détourné ?' },
      });

      expect(res.statusCode).toBe(403);
      const after = await app
        .inject({ method: 'GET', url: `/api/v1/polls/${pollId}`, headers: auth(author) })
        .then((r) => r.json<PollReply>());
      expect(after.poll.question).toBe('Pizza ou sushi ?');
    });

    it('autorise le créateur, un admin et l’owner', async () => {
      const { groupId, owner, admin, author } = await makeGroup();

      for (const actor of [author, admin, owner]) {
        const pollId = await createPoll(groupId, author);
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/v1/polls/${pollId}`,
          headers: auth(actor),
          payload: { question: 'Reformulé ?' },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('laisse le vote ouvert à tout membre — règle distincte, inchangée', async () => {
      const { groupId, member, author } = await makeGroup();
      const pollId = await createPoll(groupId, author);
      const poll = await app
        .inject({ method: 'GET', url: `/api/v1/polls/${pollId}`, headers: auth(member) })
        .then((r) => r.json<{ poll: { options: { id: string }[] } }>());

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/polls/${pollId}/vote`,
        headers: auth(member),
        payload: { optionId: poll.poll.options[0]?.id, value: true },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('todo-lists', () => {
    async function createList(groupId: string, author: AuthedUser): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/todo-lists`,
        headers: auth(author),
        payload: { title: 'Courses', initialItems: [{ text: 'Pain' }] },
      });
      return res.json<TodoListReply>().todoList.id;
    }

    it('refuse la modification par un membre simple qui n’est pas le créateur', async () => {
      const { groupId, member, author } = await makeGroup();
      const listId = await createList(groupId, author);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/todo-lists/${listId}`,
        headers: auth(member),
        payload: { title: 'Détournée' },
      });

      expect(res.statusCode).toBe(403);
      const after = await app
        .inject({ method: 'GET', url: `/api/v1/todo-lists/${listId}`, headers: auth(author) })
        .then((r) => r.json<TodoListReply>());
      expect(after.todoList.title).toBe('Courses');
    });

    it('autorise le créateur, un admin et l’owner', async () => {
      const { groupId, owner, admin, author } = await makeGroup();

      for (const actor of [author, admin, owner]) {
        const listId = await createList(groupId, author);
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/v1/todo-lists/${listId}`,
          headers: auth(actor),
          payload: { title: 'Courses renommées' },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('laisse la mutation d’un item ouverte à tout membre — hors périmètre MAN-246', async () => {
      const { groupId, member, author } = await makeGroup();
      const listId = await createList(groupId, author);
      const list = await app
        .inject({ method: 'GET', url: `/api/v1/todo-lists/${listId}`, headers: auth(member) })
        .then((r) => r.json<{ todoList: { items: { id: string }[] } }>());

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/todo-items/${list.todoList.items[0]?.id}`,
        headers: auth(member),
        payload: { done: true },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
