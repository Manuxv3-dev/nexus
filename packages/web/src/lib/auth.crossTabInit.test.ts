/**
 * Repro bout-en-bout : N onglets restaurés en même temps, chacun exécute
 * `useAuth.getState().init()` (modules réels `./auth`/`./api`, non mockés au
 * niveau des exports comme dans les autres fichiers de tests — seul `./push`
 * l'est, pour observer ses effets de bord). Cf. revue de #121 (ticket Cortex
 * `b80127ce`).
 *
 * Le protocole initialement livré (verrou + marqueur `localStorage`, l'onglet
 * perdant sautait l'appel réseau) laissait cet onglet enchaîner sur
 * `/auth/me` sans `Authorization` → 401 → `isSessionRejected` → session
 * classée refusée → `dropDevicePushSubscription()`, qui désabonne le
 * **service worker partagé par tous les onglets du navigateur** pendant que
 * les autres restaient connectés. Mesuré en revue : 3 onglets restaurés
 * ensemble → 1 déconnecté ; 5 onglets → 3 déconnectés, push cassé jusqu'au
 * rechargement.
 *
 * Ce test verrouille le correctif (verrou pur, sans saut — cf.
 * `withCrossTabRefreshLock` dans `api.ts`) : quel que soit le nombre
 * d'onglets, chacun obtient SON PROPRE access token à son tour et reste
 * connecté ; `dropDevicePushSubscription` n'est jamais appelé.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `LockManager` en mémoire qui sérialise RÉELLEMENT les callbacks (FIFO),
 * comme le ferait `navigator.locks` dans un vrai navigateur — sans ça, les N
 * `init()` lancés en parallèle appelleraient `/auth/refresh` simultanément et
 * ne reproduiraient rien.
 */
function createFakeLockManager() {
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, _opts: unknown, callback: () => Promise<unknown>) => {
    const run = queue.then(() => callback());
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  });
  return { request };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  };
}

const userPayload = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'a@b.c',
  displayName: 'A',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home',
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Simule le backend : `/auth/refresh` répond après une latence réseau
 * réaliste (20 ms) avec un nouvel `accessToken` à chaque appel ; `/auth/me`
 * n'accepte QUE les access tokens effectivement émis par ce `/auth/refresh`
 * — un onglet qui n'aurait jamais obtenu le sien (ancien protocole à saut) y
 * prendrait un 401, ce que ce test doit précisément ne jamais observer.
 */
function stubServer() {
  const issued = new Set<string>();
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      if (url.includes('/auth/refresh')) {
        await tick(20);
        n += 1;
        const token = `access-${n}`;
        issued.add(token);
        return jsonResponse(200, { accessToken: token });
      }
      if (url.includes('/auth/me')) {
        await tick(2);
        const bearer = (headers.Authorization ?? '').replace('Bearer ', '');
        return issued.has(bearer)
          ? jsonResponse(200, { user: userPayload })
          : jsonResponse(401, { error: { code: 'AUTH_TOKEN_INVALID', message: 'no' } });
      }
      return { ok: true, status: 204, headers: new Headers() };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'locks');
  window.localStorage.clear();
});

/** Charge une instance FRAÎCHE de `./auth` (+ son `./push` mocké) — un « onglet ». */
async function loadTab() {
  vi.resetModules();
  vi.doMock('./push', () => ({
    dropDevicePushSubscription: vi.fn().mockResolvedValue(undefined),
    reconcilePushSubscription: vi.fn().mockResolvedValue(undefined),
    unsubscribeFromPush: vi.fn().mockResolvedValue(undefined),
  }));
  const auth = await import('./auth');
  const push = await import('./push');
  return { auth, push };
}

async function runTabs(count: number) {
  Object.defineProperty(navigator, 'locks', {
    value: createFakeLockManager(),
    configurable: true,
    writable: true,
  });
  stubServer();
  const tabs: Awaited<ReturnType<typeof loadTab>>[] = [];
  for (let i = 0; i < count; i++) tabs.push(await loadTab());

  await Promise.all(tabs.map((t) => t.auth.useAuth.getState().init()));

  const users = tabs.map((t) => t.auth.useAuth.getState().user?.id ?? null);
  const dropped = tabs.map((t) => vi.mocked(t.push.dropDevicePushSubscription).mock.calls.length);
  return { users, dropped };
}

describe('init() — N onglets restaurés en même temps (repro revue #121)', () => {
  it('2 onglets : les deux restent connectés', async () => {
    const { users, dropped } = await runTabs(2);

    expect(users.every((u) => u === userPayload.id)).toBe(true);
    expect(dropped.every((count) => count === 0)).toBe(true);
  });

  it('3 onglets : les trois restent connectés, aucun désabonnement push', async () => {
    const { users, dropped } = await runTabs(3);

    expect(users.every((u) => u === userPayload.id)).toBe(true);
    expect(dropped.every((count) => count === 0)).toBe(true);
  });

  it('5 onglets : les cinq restent connectés, aucun désabonnement push', async () => {
    const { users, dropped } = await runTabs(5);

    expect(users.every((u) => u === userPayload.id)).toBe(true);
    expect(dropped.every((count) => count === 0)).toBe(true);
  });
});
