/**
 * Tests d'intégration de la waitlist (cf. MAN-21).
 *
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB). Endpoints
 * publics (pas d'auth) : POST /api/v1/waitlist, POST /api/v1/waitlist/unsubscribe.
 * La désinscription est un POST (email en body) plutôt qu'un DELETE avec
 * l'email en query string, pour ne jamais faire atterrir l'adresse dans une
 * URL — donc dans les logs de requête ou un access log en amont.
 *
 * Couvre :
 *   - POST persiste réellement en base (pas juste la réponse HTTP)
 *   - dédoublonnage insensible à la casse (une seule ligne)
 *   - réinscription idempotente (pas d'erreur, pas de doublon)
 *   - inscription : réponse strictement identique, email déjà connu ou non
 *   - désinscription supprime une entrée existante
 *   - désinscription : réponse strictement identique (mêmes octets), email
 *     connu ou non (anti-énumération)
 *   - validation : email invalide/absent → 400 sur les deux endpoints
 */
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

describe('waitlist endpoint', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping waitlist integration tests');
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

  /** Requête directe en base via l'index `lower(email)` — indépendante de la
   * normalisation applicative, pour que ces assertions ne présupposent pas
   * ce qu'elles vérifient. */
  async function rowsFor(email: string) {
    const { getDb } = await import('../../db/client.js');
    const { waitlist } = await import('../../db/schema/index.js');
    return getDb()
      .select()
      .from(waitlist)
      .where(sql`lower(${waitlist.email}) = ${email.toLowerCase()}`);
  }

  it('POST persiste réellement en base (pas juste la réponse HTTP)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'Persist@Example.com', source: 'landing' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const rows = await rowsFor('persist@example.com');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('persist@example.com');
    expect(rows[0]?.source).toBe('landing');
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('dédoublonne de façon insensible à la casse — une seule ligne en base', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'Case@Dedup.com' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'case@dedup.com' },
    });

    const rows = await rowsFor('case@dedup.com');
    expect(rows).toHaveLength(1);
  });

  it('réinscription d’un email déjà présent est idempotente (pas d’erreur, pas de doublon)', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'idempotent@example.com' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'idempotent@example.com' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true });

    const rows = await rowsFor('idempotent@example.com');
    expect(rows).toHaveLength(1);
  });

  it('POST renvoie une réponse strictement identique (octets), email déjà connu ou non', async () => {
    const firstTime = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'antienum-signup-new@example.com' },
    });
    const secondTime = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'antienum-signup-new@example.com' },
    });

    expect(secondTime.statusCode).toBe(firstTime.statusCode);
    expect(secondTime.body).toBe(firstTime.body);
  });

  it('désinscription supprime une entrée existante (vérifié en base)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'ToRemove@Example.com' },
    });
    expect(await rowsFor('toremove@example.com')).toHaveLength(1);

    const unsub = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist/unsubscribe',
      payload: { email: 'ToRemove@Example.com' },
    });

    expect(unsub.statusCode).toBe(200);
    expect(unsub.json()).toEqual({ ok: true });
    expect(await rowsFor('toremove@example.com')).toHaveLength(0);
  });

  it('désinscription d’un email jamais inscrit renvoie la même réponse (anti-énumération)', async () => {
    const unsub = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist/unsubscribe',
      payload: { email: 'never-subscribed@example.com' },
    });

    expect(unsub.statusCode).toBe(200);
    expect(unsub.json()).toEqual({ ok: true });
  });

  it('désinscription renvoie une réponse strictement identique (octets), email connu ou non', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'antienum-known@example.com' },
    });

    const known = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist/unsubscribe',
      payload: { email: 'antienum-known@example.com' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist/unsubscribe',
      payload: { email: 'antienum-unknown@example.com' },
    });

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
  });

  it('POST /waitlist rejette un email invalide (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist',
      payload: { email: 'pas-un-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /waitlist/unsubscribe rejette un email invalide (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist/unsubscribe',
      payload: { email: 'pas-un-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /waitlist/unsubscribe sans email est rejeté (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/waitlist/unsubscribe',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
