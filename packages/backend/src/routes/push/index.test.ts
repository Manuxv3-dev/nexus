/**
 * Tests d'intégration des routes push (cf. MAN-142, phase 1 de MAN-24
 * « notifications push PWA »).
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 * Couvre :
 *   - POST /subscribe crée une ligne push_subscriptions
 *   - POST /subscribe sur le même endpoint upsert (pas de doublon, valeurs
 *     à jour)
 *   - DELETE /subscribe supprime sa propre ligne
 *   - DELETE /subscribe sur l'endpoint d'un autre user est un noop côté DB
 *     (anti-leak — réponse identique, rien supprimé)
 *   - PATCH /subscribe met à jour `previewEnabled` de sa propre souscription
 *   - PATCH /subscribe sur l'endpoint d'un autre user est un noop côté DB
 *     (anti-leak — même pattern que DELETE)
 *   - PATCH /subscribe sur un endpoint inconnu est un noop, pas de 404 (anti-leak)
 *   - PATCH /subscribe rejette un endpoint qui ne passe pas le garde-fou SSRF
 *   - POST /subscribe pose `previewEnabled` à la création, mais ne le réécrit
 *     jamais sur un endpoint déjà connu (MAN-145 phase 4)
 *   - GET /vapid-public-key renvoie une clé publique non vide
 */
import { eq } from 'drizzle-orm';
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

describe('push subscription endpoints', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping push integration tests');
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

  async function selectByEndpoint(endpoint: string) {
    const { getDb } = await import('../../db/client.js');
    const { pushSubscriptions } = await import('../../db/schema/index.js');
    const db = getDb();
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  it('POST /subscribe crée une ligne en DB', async () => {
    const u = await registerUser(app, 'push-create@ex.com');
    const endpoint = 'https://push.example.com/sub/create-1';

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const rows = await selectByEndpoint(endpoint);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(u.id);
    expect(rows[0]?.p256dh).toBe('p256dh-value');
    expect(rows[0]?.auth).toBe('auth-value');
    expect(rows[0]?.previewEnabled).toBe(true);
  });

  it('POST /subscribe deux fois sur le même endpoint upsert (pas de doublon)', async () => {
    const u = await registerUser(app, 'push-upsert@ex.com');
    const endpoint = 'https://push.example.com/sub/upsert-1';

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'old-p256dh', auth: 'old-auth' } },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'new-p256dh', auth: 'new-auth' } },
    });
    expect(second.statusCode).toBe(200);

    const rows = await selectByEndpoint(endpoint);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe('new-p256dh');
    expect(rows[0]?.auth).toBe('new-auth');
  });

  it('DELETE /subscribe supprime sa propre ligne', async () => {
    const u = await registerUser(app, 'push-delete-own@ex.com');
    const endpoint = 'https://push.example.com/sub/delete-own-1';

    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });
    expect(await selectByEndpoint(endpoint)).toHaveLength(1);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(await selectByEndpoint(endpoint)).toHaveLength(0);
  });

  it("DELETE /subscribe sur l'endpoint d'un autre user est un noop (anti-leak)", async () => {
    const owner = await registerUser(app, 'push-owner@ex.com');
    const attacker = await registerUser(app, 'push-attacker@ex.com');
    const endpoint = 'https://push.example.com/sub/other-user-1';

    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(owner),
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });
    expect(await selectByEndpoint(endpoint)).toHaveLength(1);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/push/subscribe',
      headers: auth(attacker),
      payload: { endpoint },
    });
    // Même réponse que si c'était le bon owner — pas de 403/404 qui leak
    // l'existence de l'abonnement d'un tiers.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Mais la ligne du vrai owner n'a pas bougé.
    expect(await selectByEndpoint(endpoint)).toHaveLength(1);
  });

  it('PATCH /subscribe met à jour previewEnabled de sa propre souscription', async () => {
    const u = await registerUser(app, 'push-patch-own@ex.com');
    const endpoint = 'https://push.example.com/sub/patch-own-1';

    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });
    expect((await selectByEndpoint(endpoint))[0]?.previewEnabled).toBe(true);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, previewEnabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect((await selectByEndpoint(endpoint))[0]?.previewEnabled).toBe(false);
  });

  it("PATCH /subscribe sur l'endpoint d'un autre user est un noop (anti-leak)", async () => {
    const owner = await registerUser(app, 'push-patch-owner@ex.com');
    const attacker = await registerUser(app, 'push-patch-attacker@ex.com');
    const endpoint = 'https://push.example.com/sub/patch-other-user-1';

    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(owner),
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });
    expect((await selectByEndpoint(endpoint))[0]?.previewEnabled).toBe(true);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/push/subscribe',
      headers: auth(attacker),
      payload: { endpoint, previewEnabled: false },
    });
    // Même réponse que si c'était le bon owner — pas de 403/404 qui leak
    // l'existence de l'abonnement d'un tiers.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Mais la ligne du vrai owner n'a pas bougé.
    expect((await selectByEndpoint(endpoint))[0]?.previewEnabled).toBe(true);
  });

  it('PATCH /subscribe sur un endpoint inconnu est un noop, pas de 404 (anti-leak)', async () => {
    const u = await registerUser(app, 'push-patch-unknown@ex.com');
    const endpoint = 'https://push.example.com/sub/patch-unknown-1';

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, previewEnabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await selectByEndpoint(endpoint)).toHaveLength(0);
  });

  it.each([
    ['plain-http', 'http://push.example.com/sub/plain'],
    ['loopback', 'https://127.0.0.1:6379/sub/x'],
    ['private-net', 'https://192.168.1.10/sub/x'],
    ['cloud-metadata', 'https://169.254.169.254/latest/meta-data'],
    ['internal-host', 'https://redis.internal/sub/x'],
  ])('POST /subscribe rejette un endpoint %s (anti-SSRF)', async (label, endpoint) => {
    const u = await registerUser(app, `push-ssrf-${label}@ex.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });

    // Le backend POST vers cet endpoint à chaque notification : l'accepter
    // ferait de lui un proxy SSRF aveugle vers le réseau interne du VPS.
    expect(res.statusCode).toBe(400);
    expect(await selectByEndpoint(endpoint)).toHaveLength(0);
  });

  it('POST /subscribe pose previewEnabled fourni à la création (choix fait avant abonnement)', async () => {
    const u = await registerUser(app, 'push-subscribe-preview-off@ex.com');
    const endpoint = 'https://push.example.com/sub/preview-off-1';

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: {
        endpoint,
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
        previewEnabled: false,
      },
    });

    expect(res.statusCode).toBe(200);
    // Sans ça, le choix « Aperçu OFF » fait avant l'activation du push serait
    // perdu et le premier push partirait en clair.
    expect((await selectByEndpoint(endpoint))[0]?.previewEnabled).toBe(false);
  });

  it('POST /subscribe ne réécrit pas previewEnabled sur un endpoint déjà connu', async () => {
    const u = await registerUser(app, 'push-resubscribe-preview@ex.com');
    const endpoint = 'https://push.example.com/sub/preview-resubscribe-1';

    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, previewEnabled: false },
    });

    // Re-subscribe (rotation de clés navigateur) SANS previewEnabled, puis
    // avec une valeur contradictoire : la valeur en base fait foi dans les
    // deux cas — un renouvellement d'abonnement ne doit pas rallumer l'aperçu.
    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, keys: { p256dh: 'p256dh-rotated', auth: 'auth-rotated' } },
    });
    expect((await selectByEndpoint(endpoint))[0]?.previewEnabled).toBe(false);

    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: {
        endpoint,
        keys: { p256dh: 'p256dh-rotated-2', auth: 'auth-rotated-2' },
        previewEnabled: true,
      },
    });
    const rows = await selectByEndpoint(endpoint);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.previewEnabled).toBe(false);
    expect(rows[0]?.p256dh).toBe('p256dh-rotated-2');
  });

  it.each([
    ['plain-http', 'http://push.example.com/sub/plain'],
    ['loopback', 'https://127.0.0.1:6379/sub/x'],
    ['private-net', 'https://192.168.1.10/sub/x'],
    ['cloud-metadata', 'https://169.254.169.254/latest/meta-data'],
    ['internal-host', 'https://redis.internal/sub/x'],
  ])('PATCH /subscribe rejette un endpoint %s (anti-SSRF)', async (label, endpoint) => {
    const u = await registerUser(app, `push-patch-ssrf-${label}@ex.com`);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/push/subscribe',
      headers: auth(u),
      payload: { endpoint, previewEnabled: false },
    });

    // Même garde-fou SSRF que POST : `PushEndpointSchema` est réutilisé tel quel.
    expect(res.statusCode).toBe(400);
  });

  it('GET /vapid-public-key renvoie une clé publique non vide', async () => {
    const u = await registerUser(app, 'push-vapid@ex.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/push/vapid-public-key',
      headers: auth(u),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ publicKey: string }>();
    expect(typeof body.publicKey).toBe('string');
    expect(body.publicKey.length).toBeGreaterThan(0);
  });
});
