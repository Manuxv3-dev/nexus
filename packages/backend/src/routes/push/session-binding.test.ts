/**
 * Un abonnement push est lié à la session qui l'a créé, et ne reçoit plus
 * rien quand cette session meurt (cf. ticket abf71bf4).
 *
 * `push_subscriptions` ne portait qu'un `user_id` et un `endpoint`. Les
 * correctifs #88 et #89 désabonnent l'appareil côté client, au logout et à
 * l'expiration constatée — mais rien côté serveur ne coupait jamais un
 * abonnement : « déconnecter mes autres appareils », changer de mot de passe
 * après une compromission, une session expirée sur une machine où l'app
 * n'est plus ouverte… tout continuait de recevoir, avec aperçu.
 *
 * Le lien est l'identité de session (`session_id` : le premier refresh token
 * de la chaîne, hérité à chaque rotation), portée par le JWT d'accès (`sid`)
 * et posée par `POST /push/subscribe`. Le filtre est à l'ENVOI, pas en
 * cascade à l'écriture : un seul point de vérité qui couvre logout,
 * logout-all, changement de mot de passe, réutilisation ET expiration —
 * qu'aucun job ne purge — sans en oublier un.
 *
 * `web-push` est mocké comme dans `push.e2e.test.ts` : c'est l'appel à
 * `sendNotification` qui prouve qu'un abonnement reçoit encore, ou plus.
 * Skip auto si Postgres n'est pas joignable (sandbox sans DB).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPostgresAvailable, setupTestDb, type TestDb } from '../../test/db.js';
import { setTestEnv } from '../../test/helpers.js';

const sendNotificationMock = vi.fn();
vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]): unknown => sendNotificationMock(...args),
    setVapidDetails: (): void => undefined,
  },
}));

const BASE_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';

const PASSWORD = 'a-very-long-password-x';

/** Une session = un couple access/refresh. Mode natif : le refresh transite en body. */
interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

describe('push — abonnement lié à la session (abf71bf4)', async () => {
  const pgUp = await isPostgresAvailable(BASE_DB_URL);

  it.skipIf(!pgUp)('placeholder when postgres unavailable', () => {
    expect(true).toBe(true);
  });

  if (!pgUp) {
    console.warn('  ⚠ Postgres unavailable, skipping push session-binding tests');
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

  beforeEach(() => {
    sendNotificationMock.mockReset();
    sendNotificationMock.mockResolvedValue(undefined);
  });

  function session(body: { user: { id: string }; accessToken: string; refreshToken: string }) {
    return { userId: body.user.id, accessToken: body.accessToken, refreshToken: body.refreshToken };
  }

  async function register(email: string): Promise<Session> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: PASSWORD, displayName: email.split('@')[0] },
    });
    if (res.statusCode !== 200) throw new Error(`register ${email}: ${res.statusCode} ${res.body}`);
    return session(res.json());
  }

  /** Une deuxième session du même compte — un autre appareil. */
  async function login(email: string): Promise<Session> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: PASSWORD },
    });
    if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.statusCode} ${res.body}`);
    return session(res.json());
  }

  function auth(s: Session): { authorization: string } {
    return { authorization: `Bearer ${s.accessToken}` };
  }

  async function subscribe(s: Session, endpoint: string): Promise<void> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      headers: auth(s),
      payload: { endpoint, keys: { p256dh: 'p256dh', auth: 'auth' } },
    });
    if (res.statusCode !== 200) throw new Error(`subscribe: ${res.statusCode} ${res.body}`);
  }

  /** Déclenche un push pour `userId` par le choke point d'insertion des notifs. */
  async function notify(userId: string): Promise<string[]> {
    const { insertNotification } = await import('../notifications/repo.js');
    sendNotificationMock.mockClear();
    const row = await insertNotification({ userId, kind: 'todo_assigned', payload: {} });
    expect(row).not.toBeNull();
    return sendNotificationMock.mock.calls
      .map((call) => (call[0] as { endpoint: string }).endpoint)
      .sort();
  }

  it('logout-all coupe le push des autres appareils', async () => {
    const email = 'push-bind-logout-all@ex.com';
    const phone = await register(email);
    const laptop = await login(email);
    await subscribe(laptop, 'https://push.example/laptop');
    expect(await notify(phone.userId)).toEqual(['https://push.example/laptop']);

    // Depuis le téléphone : « déconnecter mes autres appareils ».
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout-all',
      headers: auth(phone),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    // Le portable — perdu, prêté — ne reçoit plus rien.
    //
    // Seul le portable est abonné ici, à dessein : le backend révoque AUSSI la
    // session courante (`revokeAllRefreshTokens` sans exclusion), là où l'UI
    // promet « ta session courante reste active » — écart préexistant, tracé
    // à part. Le push suit la session quoi qu'il en soit ; ce test n'a pas à
    // figer ce que « courante » veut dire.
    expect(await notify(phone.userId)).toEqual([]);
  });

  it('un changement de mot de passe coupe le push partout — le scénario « compte compromis »', async () => {
    const email = 'push-bind-password@ex.com';
    const s = await register(email);
    await subscribe(s, 'https://push.example/compromised');
    expect(await notify(s.userId)).toEqual(['https://push.example/compromised']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: auth(s),
      payload: { currentPassword: PASSWORD, newPassword: 'another-very-long-password-y' },
    });
    expect(res.statusCode).toBe(200);

    expect(await notify(s.userId)).toEqual([]);
  });

  it("l'abonnement suit la rotation du refresh token, et tombe au logout", async () => {
    const s = await register('push-bind-rotation@ex.com');
    await subscribe(s, 'https://push.example/rotating');

    // Rotation : nouvelle paire, la chaîne continue — l'abonnement doit suivre.
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: s.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json<{ accessToken: string; refreshToken: string }>();
    expect(await notify(s.userId)).toEqual(['https://push.example/rotating']);

    // Logout de cette session — avec le token roté, le seul encore valide.
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${next.accessToken}` },
      payload: { refreshToken: next.refreshToken },
    });
    expect(out.statusCode).toBe(200);

    // Côté serveur, sans compter sur le DELETE du client (#88) : plus rien.
    expect(await notify(s.userId)).toEqual([]);
  });

  it("un abonnement d'avant la liaison (session_id NULL) reçoit toujours", async () => {
    // Les lignes existantes en prod n'ont pas de session : couper le push de
    // tout le monde au déploiement n'est pas une option. Elles se lient au
    // prochain toggle des Réglages.
    const { subscribeUser } = await import('./repo.js');
    const s = await register('push-bind-legacy@ex.com');
    await subscribeUser(s.userId, {
      endpoint: 'https://push.example/legacy',
      keys: { p256dh: 'p256dh', auth: 'auth' },
      sessionId: null,
    });

    expect(await notify(s.userId)).toEqual(['https://push.example/legacy']);
  });

  it('un abonnement dont la session est morte est supprimé au passage', async () => {
    const email = 'push-bind-prune@ex.com';
    const phone = await register(email);
    const laptop = await login(email);
    await subscribe(laptop, 'https://push.example/pruned');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout-all',
      headers: auth(phone),
      payload: {},
    });
    await notify(phone.userId);

    // La ligne liée à la session morte a été retirée à l'envoi — pas
    // seulement ignorée : elle n'a plus de raison d'exister.
    const { getDb } = await import('../../db/client.js');
    const { pushSubscriptions } = await import('../../db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await getDb()
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, 'https://push.example/pruned'));
    expect(rows).toEqual([]);

    // Le portable se reconnecte (nouvelle session) et re-souscrit le même
    // endpoint : recréé, lié à la session vivante, il reçoit à nouveau.
    const back = await login(email);
    await subscribe(back, 'https://push.example/pruned');
    expect(await notify(phone.userId)).toEqual(['https://push.example/pruned']);
  });
});
