/**
 * Réconciliation de l'abonnement push au montage d'une session authentifiée
 * valide (cf. ticket d6772b47, lacune de MAN-146 phase 5 sur MAN-24).
 *
 * `getPushSubscriptionStatus()` ne lit que l'état NAVIGATEUR : si le serveur a
 * élagué à tort la ligne `push_subscriptions` (faux positif 404/410 — un
 * intermédiaire réseau qui répond « gone » sans que l'abonnement navigateur
 * soit réellement mort), Settings continue d'afficher le toggle à ON alors
 * qu'aucun push ne peut plus arriver, sans chemin de récupération autre qu'un
 * OFF/ON manuel.
 *
 * Correctif : au succès de `init()` (session confirmée valide — même endroit
 * du cycle de vie que le désabonnement de #89 côté échec, cf.
 * `auth.expiredPush.test.ts`), on ré-envoie l'abonnement navigateur existant à
 * `POST /push/subscribe`. L'upsert serveur (`subscribeUser`, cf.
 * `routes/push/repo.ts`) est idempotent par `endpoint` : no-op si la ligne
 * existe encore, restauration si elle a été purgée à tort. Le détail du
 * comportement de `reconcilePushSubscription()` elle-même (corps envoyé,
 * no-op sans souscription navigateur) est verrouillé dans `push.test.ts` —
 * ici on ne teste QUE le branchement dans le cycle de vie de la session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './api';
import type * as ApiModule from './api';
import { type User, useAuth } from './auth';
import { dropDevicePushSubscription, reconcilePushSubscription } from './push';
import type * as TauriModule from './tauri';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

vi.mock('./push', () => ({
  dropDevicePushSubscription: vi.fn().mockResolvedValue(undefined),
  unsubscribeFromPush: vi.fn().mockResolvedValue(undefined),
  reconcilePushSubscription: vi.fn().mockResolvedValue(undefined),
}));

// `./api` consomme d'autres exports de `./tauri` : on part du module réel et
// on n'override que ce dont le test a besoin (comme `auth.expiredPush.test.ts`).
vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, isTauri: () => false };
});

/**
 * Laisse retomber les promesses lancées en fire-and-forget par `init()`
 * (même helper que `auth.expiredPush.test.ts`) : la réconciliation, comme le
 * désabonnement de #89, n'est pas `await`ée par `init()` — l'attendre ici
 * évite un test qui passe seulement par chance d'ordonnancement des
 * microtasks.
 */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
  };
}

/** Fait résoudre `init()` en succès pour l'utilisateur `id`. */
function mockSuccessfulRefresh(id: string) {
  vi.mocked(api).mockImplementation((opts: unknown) => {
    const { path } = opts as { path: string };
    if (path === '/auth/refresh') return Promise.resolve({ accessToken: 'access-token' });
    if (path === '/auth/me') return Promise.resolve(userReply(id));
    return Promise.reject(new Error(`unexpected api call: ${path}`));
  });
}

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(dropDevicePushSubscription).mockClear().mockResolvedValue(undefined);
  vi.mocked(reconcilePushSubscription).mockClear().mockResolvedValue(undefined);
  useAuth.setState({ user: null, initializing: true });
});

describe('init() — réconciliation push au montage', () => {
  it('session valide : réconcilie une fois', async () => {
    mockSuccessfulRefresh('11111111-1111-4111-8111-111111111111');

    await useAuth.getState().init();
    await flushMicrotasks();

    expect(reconcilePushSubscription).toHaveBeenCalledTimes(1);
  });

  it('remontage (même utilisateur) : ne réconcilie pas une seconde fois', async () => {
    mockSuccessfulRefresh('22222222-2222-4222-8222-222222222222');

    await useAuth.getState().init();
    await flushMicrotasks();
    await useAuth.getState().init();
    await flushMicrotasks();

    expect(reconcilePushSubscription).toHaveBeenCalledTimes(1);
  });

  it('nouvelle session (utilisateur différent) : réconcilie de nouveau', async () => {
    mockSuccessfulRefresh('33333333-3333-4333-8333-333333333333');
    await useAuth.getState().init();
    await flushMicrotasks();
    expect(reconcilePushSubscription).toHaveBeenCalledTimes(1);

    mockSuccessfulRefresh('44444444-4444-4444-8444-444444444444');
    await useAuth.getState().init();
    await flushMicrotasks();

    expect(reconcilePushSubscription).toHaveBeenCalledTimes(2);
  });

  it('session invalide (401) : ne réconcilie pas — le désabonnement de #89 reste inchangé', async () => {
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(401, { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired' }),
    );

    await useAuth.getState().init();
    await flushMicrotasks();

    expect(reconcilePushSubscription).not.toHaveBeenCalled();
    expect(dropDevicePushSubscription).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().user).toBeNull();
  });

  it('échec réseau au démarrage : ne réconcilie pas, ne désabonne pas non plus', async () => {
    vi.mocked(api).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await useAuth.getState().init();
    await flushMicrotasks();

    expect(reconcilePushSubscription).not.toHaveBeenCalled();
    expect(dropDevicePushSubscription).not.toHaveBeenCalled();
  });

  it('un échec de réconciliation ne casse pas init() et reste silencieux (console.warn)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockSuccessfulRefresh('55555555-5555-4555-8555-555555555555');
    vi.mocked(reconcilePushSubscription).mockRejectedValueOnce(new Error('backend down'));

    await expect(useAuth.getState().init()).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(useAuth.getState().user).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('réconciliation'), expect.any(Error));
  });
});
