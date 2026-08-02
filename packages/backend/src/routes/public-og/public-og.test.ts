/**
 * Tests d'intégration GET /api/v1/public/og/:type/:slug.png (cf. ADR-018).
 *
 * MAN-16 : expense/todo/list lisaient encore le stub in-memory
 * `killer-features/store.js`, jamais alimenté depuis que les routes réelles
 * écrivent en base via Drizzle (`expenses/repo.ts`, `todos/repo.ts`). Toute
 * ressource réelle renvoyait donc 404 — pas de carte de prévisualisation.
 *
 * `og-renderer.js` (fonts + Satori + cache Redis) est mocké : le pipeline de
 * rendu réel bute sur un bug préexistant et indépendant (Satori 0.10.14 +
 * `@shuding/opentype.js` 1.4.0-beta.0 échoue à parser la table `fvar` de
 * `Inter.ttf`, quel que soit le type — event/poll y compris). Hors périmètre
 * MAN-16 ; ce test se concentre sur la résolution de la ressource (Drizzle
 * vs store in-memory), pas sur le rendu PNG — le mock capture les arguments
 * passés à `renderOgPng` pour vérifier `updatedAt` et le nom du payeur sans
 * dépendre du rendu réel.
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';

const renderOgPng = vi.fn((_req: unknown) => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
vi.mock('./og-renderer.js', () => ({
  fontsAvailable: () => true,
  renderOgPng: (req: unknown) => renderOgPng(req),
}));

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

describe('public OG image endpoint', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    // eslint-disable-next-line no-console
    console.warn('  ⚠ Postgres unavailable, skipping public-og integration tests');
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

  async function createGroup(u: AuthedUser, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: auth(u),
      payload: { name },
    });
    if (res.statusCode !== 200) {
      throw new Error(`createGroup ${name} failed: ${res.statusCode} ${res.body}`);
    }
    const body = res.json() as { group: { id: string } };
    return body.group.id;
  }

  it('rend une image OG pour une dépense réelle (créée en base via Drizzle)', async () => {
    const u = await registerUser(app, 'og-expense@ex.com');
    const groupId = await createGroup(u, 'OG expense grp');
    renderOgPng.mockClear();
    const created = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/expenses`,
        headers: auth(u),
        payload: {
          description: 'Courses',
          amountCents: 1000,
          currency: 'EUR',
          paidBy: u.id,
          shares: [{ userId: u.id, shareCents: 1000 }],
        },
      })
      .then((r) => r.json() as { expense: { slug: string; updatedAt: string } });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/og/expense/${created.expense.slug}.png`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');

    // Vérifie que la clé de cache et le nom du payeur viennent bien de la
    // base Drizzle (`updatedAt`, `displayName`) et non du stub in-memory
    // (`createdAt`, UUID brut) — les deux lignes que MAN-16 devait corriger.
    expect(renderOgPng).toHaveBeenCalledTimes(1);
    const call = renderOgPng.mock.calls[0]?.[0] as { updatedAt: string; template: unknown };
    expect(call.updatedAt).toBe(created.expense.updatedAt);
    const templateJson = JSON.stringify(call.template);
    expect(templateJson).toContain('og-expense');
    expect(templateJson).not.toContain(u.id);
  });

  it('rend une image OG pour une todo list réelle (créée en base via Drizzle)', async () => {
    const u = await registerUser(app, 'og-todo@ex.com');
    const groupId = await createGroup(u, 'OG todo grp');
    const created = await app
      .inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/todo-lists`,
        headers: auth(u),
        payload: { title: 'Qui amène quoi' },
      })
      .then((r) => r.json() as { todoList: { slug: string } });

    const resTodo = await app.inject({
      method: 'GET',
      url: `/api/v1/public/og/todo/${created.todoList.slug}.png`,
    });
    expect(resTodo.statusCode).toBe(200);
    expect(resTodo.headers['content-type']).toBe('image/png');

    // `list` est le même type de ressource que `todo`, rendu avec un autre
    // template (cf. buildTemplateForSlug) — même slug, autre :type.
    const resList = await app.inject({
      method: 'GET',
      url: `/api/v1/public/og/list/${created.todoList.slug}.png`,
    });
    expect(resList.statusCode).toBe(200);
    expect(resList.headers['content-type']).toBe('image/png');
  });

  it('renvoie 404 pour un slug de dépense inconnu', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/og/expense/nonexistentslug.png',
    });
    expect(res.statusCode).toBe(404);
  });
});
