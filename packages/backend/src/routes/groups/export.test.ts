/**
 * Tests d'intégration `GET /api/v1/groups/:groupId/export` (ticket 645f29ca).
 *
 * Couvre :
 *   - owner → 200, `Content-Disposition`, JSON conforme à `GroupExportSchema`,
 *     chaque collection présente avec les bons comptes
 *   - admin → 200 (même autorisation que owner, cf. décision du ticket)
 *   - membre simple → 403 (l'export expose les données de tous les membres)
 *   - non-membre → 404 (anti-leak, même code que `requireGroupMembership`
 *     ailleurs)
 *   - groupe inexistant → 404
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';
import {
  auth,
  createHttpHelpers,
  type AuthedUser,
  type HttpHelpers,
} from '../../test/http-helpers.js';

import type { GroupExport } from './export-schema.js';

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

describe('export de groupe (GET /groups/:groupId/export)', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping groups export integration tests');
    return;
  }

  let testDb: TestDb;
  let app: FastifyInstance;
  let registerUser: HttpHelpers['registerUser'];
  let makeGroup: HttpHelpers['makeGroup'];
  let joinGroup: HttpHelpers['joinGroup'];

  beforeAll(async () => {
    testDb = await setupTestDb(BASE_DB_URL);
    setTestEnv();
    process.env['DATABASE_URL'] = testDb.url;
    const { resetEnvCache } = await import('../../core/env.js');
    resetEnvCache();

    const { buildServer } = await import('../../server.js');
    app = await buildServer();
    ({ registerUser, makeGroup, joinGroup } = createHttpHelpers(app));
  });

  afterAll(async () => {
    if (app) await app.close();
    const { closeDb } = await import('../../db/client.js');
    const { closeRedis } = await import('../../db/health.js');
    await closeDb();
    await closeRedis();
    if (testDb) await testDb.cleanup();
  });

  /**
   * Peuple un groupe avec un jeu de données couvrant chaque collection de
   * l'export : 1 event (2 RSVP), 1 sondage (1 vote), 1 dépense (2 parts),
   * 1 liste de todo (2 items). `owner` porte tout, `other` complète les
   * comptes (2e RSVP, 2e part).
   */
  async function seedGroup(owner: AuthedUser, other: AuthedUser, name: string): Promise<string> {
    const groupId = await makeGroup(owner, name);
    await joinGroup(owner, groupId, other);

    const eventRes = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/events`,
        headers: auth(owner),
        payload: {
          title: 'Soirée jeux',
          startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        },
      })
      .then((r) => r.json<{ event: { id: string } }>());
    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventRes.event.id}/rsvp`,
      headers: auth(owner),
      payload: { value: 'yes' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventRes.event.id}/rsvp`,
      headers: auth(other),
      payload: { value: 'no' },
    });

    const pollRes = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/polls`,
        headers: auth(owner),
        payload: { question: 'Pizza ou sushi ?', options: ['Pizza', 'Sushi'] },
      })
      .then((r) => r.json<{ poll: { id: string; options: { id: string }[] } }>());
    const firstOptionId = pollRes.poll.options[0]?.id;
    if (!firstOptionId) throw new Error('poll option missing in test fixture');
    await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${pollRes.poll.id}/vote`,
      headers: auth(owner),
      payload: { optionId: firstOptionId, value: true },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/expenses`,
      headers: auth(owner),
      payload: {
        description: 'Courses',
        amountCents: 2000,
        currency: 'EUR',
        paidBy: owner.id,
        shares: [
          { userId: owner.id, shareCents: 1000 },
          { userId: other.id, shareCents: 1000 },
        ],
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/todo-lists`,
      headers: auth(owner),
      payload: {
        title: 'À acheter',
        initialItems: [{ text: 'Pain' }, { text: 'Lait' }],
      },
    });

    return groupId;
  }

  it('owner → 200, Content-Disposition, JSON conforme, comptes par collection corrects', async () => {
    const owner = await registerUser('export-owner@ex.com');
    const other = await registerUser('export-other@ex.com');
    const groupId = await seedGroup(owner, other, 'Export Owner Group');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/export`,
      headers: auth(owner),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="nexus-export-owner-group-\d{8}\.json"$/,
    );

    const body = res.json<GroupExport>();
    expect(body.formatVersion).toBe(1);
    expect(body.exportedBy).toBe(owner.id);
    expect(body.group.id).toBe(groupId);

    expect(body.members).toHaveLength(2);

    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.rsvps).toHaveLength(2);

    expect(body.polls).toHaveLength(1);
    const totalVoters = body.polls[0]?.options.flatMap((o) => o.voters) ?? [];
    expect(totalVoters).toHaveLength(1);

    expect(body.expenses).toHaveLength(1);
    expect(body.expenses[0]?.shares).toHaveLength(2);

    expect(body.todoLists).toHaveLength(1);
    expect(body.todoLists[0]?.items).toHaveLength(2);
  });

  it('admin → 200 (même autorisation que owner)', async () => {
    const owner = await registerUser('export-admin-owner@ex.com');
    const admin = await registerUser('export-admin-admin@ex.com');
    const groupId = await makeGroup(owner, 'Export Admin Group');
    await joinGroup(owner, groupId, admin, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/export`,
      headers: auth(admin),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<GroupExport>().exportedBy).toBe(admin.id);
  });

  it('membre simple → 403 (autorisation owner/admin uniquement)', async () => {
    const owner = await registerUser('export-member-owner@ex.com');
    const member = await registerUser('export-member-member@ex.com');
    const groupId = await makeGroup(owner, 'Export Member Group');
    await joinGroup(owner, groupId, member, 'member');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/export`,
      headers: auth(member),
    });

    expect(res.statusCode).toBe(403);
  });

  it('non-membre → 404 (anti-leak, même code que requireGroupMembership ailleurs)', async () => {
    const owner = await registerUser('export-outsider-owner@ex.com');
    const outsider = await registerUser('export-outsider@ex.com');
    const groupId = await makeGroup(owner, 'Export Outsider Group');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/export`,
      headers: auth(outsider),
    });

    expect(res.statusCode).toBe(404);
  });

  it('groupe inexistant → 404', async () => {
    const owner = await registerUser('export-missing-group@ex.com');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/groups/00000000-0000-0000-0000-000000000000/export',
      headers: auth(owner),
    });

    expect(res.statusCode).toBe(404);
  });
});
