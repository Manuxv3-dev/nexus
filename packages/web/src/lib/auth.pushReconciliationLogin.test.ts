/**
 * Réconciliation de l'abonnement push après `login()`/`register()` — point 1
 * du ticket 792fa6d5 (complément de #111, qui ne branchait la réconciliation
 * qu'au montage via `init()`).
 *
 * Depuis #100 un abonnement push est lié à sa session (`session_id`). Les
 * lignes créées avant #100 (`session_id = NULL`) ne se relient qu'au prochain
 * `POST /push/subscribe` — #111 l'a ajouté à `init()` (démarrage de l'app),
 * pas à une connexion explicite : un `logout()` puis `login()` du même
 * utilisateur, dans le même onglet, sans redémarrer l'app, n'était donc pas
 * couvert.
 *
 * Contrairement à `auth.pushReconciliation.test.ts` (qui mocke `./push` en
 * entier pour isoler le branchement dans le cycle de vie de `init()`), ce
 * fichier ne mocke QUE `./api` et laisse tourner le vrai
 * `reconcilePushSubscription()` (`lib/push.ts`) — pour PINNER qu'un véritable
 * `POST /push/subscribe` part après un login réussi quand le navigateur a une
 * souscription active, pas seulement que la fonction de réconciliation est
 * invoquée. Le détail du corps envoyé par `reconcilePushSubscription()`
 * lui-même (endpoint/keys/previewEnabled) reste testé une seule fois, dans
 * `push.test.ts` — non dupliqué ici.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import type * as ApiModule from './api';
import { type User, useAuth } from './auth';
import type * as TauriModule from './tauri';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

// `./api` consomme d'autres exports de `./tauri` (setRefreshToken persiste au
// magasin de secrets en mode natif) : on part du module réel et on force le
// mode web, comme `auth.pushReconciliation.test.ts`.
vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, isTauri: () => false };
});

const mockedApi = vi.mocked(api);

/** Simule (ou retire) le support Push API sur `window`. */
function definePushManagerSupport(supported: boolean) {
  if (supported) {
    Object.defineProperty(window, 'PushManager', {
      value: class {},
      configurable: true,
      writable: true,
    });
  } else {
    Reflect.deleteProperty(window, 'PushManager');
  }
}

/** Simule (ou retire) `navigator.serviceWorker`. */
function defineServiceWorker(sw: unknown) {
  if (sw === undefined) {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    return;
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: sw,
    configurable: true,
    writable: true,
  });
}

/** Registration dont la souscription navigateur est `subscription` (ou absente si `undefined`). */
function defineServiceWorkerWithSubscription(subscription: unknown) {
  const getSubscription = vi.fn().mockResolvedValue(subscription);
  const getRegistration = vi.fn().mockResolvedValue({ pushManager: { getSubscription } });
  defineServiceWorker({ getRegistration, register: vi.fn() });
  definePushManagerSupport(true);
}

const activeSubscription = {
  endpoint: 'https://push.example/abc',
  toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
};

function userReply(id: string) {
  return {
    user: {
      id,
      email: `${id}@example.com`,
      displayName: id,
      avatarUrl: null,
      themePreference: null,
      landingPreference: 'home',
      onboardingStep: null,
      onboardingCompletedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as unknown as User,
    accessToken: 'access-token',
  };
}

/** Route les appels `api()` d'un `login()`/`register()` réussi + `/push/subscribe`. */
function mockAuthAndPushEndpoints(
  authPath: '/auth/login' | '/auth/register',
  userId: string,
  pushSubscribeImpl: () => Promise<unknown> = () => Promise.resolve({ ok: true }),
) {
  mockedApi.mockImplementation((opts: unknown) => {
    const { path } = opts as { path: string };
    if (path === authPath) return Promise.resolve(userReply(userId));
    if (path === '/push/subscribe') return pushSubscribeImpl();
    return Promise.reject(new Error(`unexpected api call: ${path}`));
  });
}

/** Laisse retomber la promesse fire-and-forget de `reconcilePushForSession`. */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockedApi.mockReset();
  useAuth.setState({ user: null, initializing: false });
});

afterEach(() => {
  defineServiceWorker(undefined);
  definePushManagerSupport(false);
});

describe('login() — réconciliation push', () => {
  it('souscription navigateur active : un vrai POST /push/subscribe part après le login', async () => {
    defineServiceWorkerWithSubscription(activeSubscription);
    const userId = '11111111-1111-4111-8111-111111111111';
    mockAuthAndPushEndpoints('/auth/login', userId);

    await useAuth.getState().login(`${userId}@example.com`, 'hunter2');
    await flushMicrotasks();

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/push/subscribe',
        body: expect.objectContaining({ endpoint: 'https://push.example/abc' }),
      }),
    );
  });

  it('aucune souscription navigateur : le login ne poste rien à /push/subscribe', async () => {
    defineServiceWorkerWithSubscription(undefined);
    const userId = '22222222-2222-4222-8222-222222222222';
    mockAuthAndPushEndpoints('/auth/login', userId);

    await useAuth.getState().login(`${userId}@example.com`, 'hunter2');
    await flushMicrotasks();

    expect(mockedApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: '/push/subscribe' }),
    );
  });

  it('échec réseau de la réconciliation : warn loggé, le login reste résolu (jamais bloquant)', async () => {
    defineServiceWorkerWithSubscription(activeSubscription);
    const userId = '33333333-3333-4333-8333-333333333333';
    mockAuthAndPushEndpoints('/auth/login', userId, () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const user = await useAuth.getState().login(`${userId}@example.com`, 'hunter2');
    await flushMicrotasks();

    expect(user.id).toBe(userId);
    expect(useAuth.getState().user?.id).toBe(userId);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('réconciliation'), expect.any(Error));
  });

  it('navigateur sans support Web Push : le login ne tente aucun appel /push/subscribe', async () => {
    defineServiceWorker(undefined);
    definePushManagerSupport(false);
    const userId = '44444444-4444-4444-8444-444444444444';
    mockAuthAndPushEndpoints('/auth/login', userId);

    await expect(
      useAuth.getState().login(`${userId}@example.com`, 'hunter2'),
    ).resolves.toBeDefined();
    await flushMicrotasks();

    expect(mockedApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: '/push/subscribe' }),
    );
  });
});

describe('register() — réconciliation push', () => {
  it('souscription navigateur active : un vrai POST /push/subscribe part après le register', async () => {
    defineServiceWorkerWithSubscription(activeSubscription);
    const userId = '55555555-5555-4555-8555-555555555555';
    mockAuthAndPushEndpoints('/auth/register', userId);

    await useAuth.getState().register(`${userId}@example.com`, 'hunter2', 'Nouveau');
    await flushMicrotasks();

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/push/subscribe',
        body: expect.objectContaining({ endpoint: 'https://push.example/abc' }),
      }),
    );
  });
});
