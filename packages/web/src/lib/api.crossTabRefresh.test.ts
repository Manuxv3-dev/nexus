/**
 * Sérialisation du refresh entre onglets (Web Locks) — cf. ticket Cortex
 * `b80127ce`.
 *
 * `api.ts` dédoublonnait déjà le refresh concurrent DANS un onglet
 * (`refreshInFlight`), pas ENTRE onglets : le cookie `nexus_refresh` est
 * partagé par le navigateur, et N onglets qui rafraîchissent en même temps
 * (réouverture du navigateur, retour de veille) rejouaient chacun le même
 * token T0 — au-delà de 2 onglets, la fenêtre de grâce d'ADR-040 finit par
 * révoquer TOUTE la session utilisateur (`AUTH_REFRESH_REUSED`).
 *
 * Le correctif sérialise (verrou pur, sans saut d'appel) : chaque onglet
 * exécute le POST à son tour et obtient SON PROPRE nouvel access token — cf.
 * JSDoc de `withCrossTabRefreshLock` dans `api.ts` pour l'historique d'une
 * première version (à marqueur `localStorage`, l'onglet perdant sautait
 * l'appel réseau) qui cassait le push partagé du navigateur, corrigée en
 * revue.
 *
 * Deux « onglets » sont simulés ici par deux instances du module `./api`
 * (`vi.resetModules()` + `import()` dynamique) : chacune a son propre état
 * privé (`accessTokenInMemory`, `refreshInFlight`), mais les deux partagent
 * le même `window` jsdom — donc les mêmes `fetch`/`navigator` globaux, comme
 * deux onglets réels du même navigateur partagent cookies et réseau sans
 * partager leur tas JS. C'est le seul test du repo qui a besoin de
 * `resetModules()` pour de vrai (cf. commentaire contraire dans
 * `auth.pushReconciliation.test.ts`, qui s'en passe car il ne teste pas un
 * état privé PAR ONGLET).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAccessToken, setRefreshToken, tryRefresh } from './api';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/**
 * `LockManager` en mémoire qui sérialise RÉELLEMENT les callbacks (FIFO),
 * comme le ferait `navigator.locks` dans un vrai navigateur — indispensable
 * pour que le test « deux onglets » ci-dessous exerce la vraie course (le 2e
 * callback ne démarre qu'une fois le 1er totalement résolu, réseau compris).
 */
function createFakeLockManager() {
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, _opts: unknown, callback: () => Promise<unknown>) => {
    const run = queue.then(() => callback());
    // Garde la file vivante même si un callback rejette : un onglet dont le
    // refresh échoue ne doit pas bloquer le suivant.
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  });
  return { request };
}

function stubLockManager() {
  const manager = createFakeLockManager();
  Object.defineProperty(navigator, 'locks', {
    value: manager,
    configurable: true,
    writable: true,
  });
  return manager;
}

function clearLockManager(): void {
  Reflect.deleteProperty(navigator, 'locks');
}

interface FetchCall {
  url: string;
  resolvedAt: number;
}

/** Compte les appels réseau ; répond à chacun avec un accessToken distinct, après une latence simulée. */
function stubRefreshFetch(latencyMs = 0): FetchCall[] {
  const calls: FetchCall[] = [];
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      n += 1;
      calls.push({ url, resolvedAt: Date.now() });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ accessToken: `access-${n}` }),
      };
    }),
  );
  return calls;
}

function refreshCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.url.includes('/auth/refresh'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearLockManager();
  window.localStorage.clear();
  delete window.__TAURI_INTERNALS__;
  setAccessToken(null);
  setRefreshToken(null, false);
});

describe('tryRefresh — dédup dans l’onglet (non-régression)', () => {
  it('deux refresh concurrents dans le même onglet ne font qu’un seul POST', async () => {
    const calls = stubRefreshFetch();

    const [a, b] = await Promise.all([tryRefresh(), tryRefresh()]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshCalls(calls)).toHaveLength(1);
  });
});

describe('tryRefresh — sérialisation entre onglets (Web Locks)', () => {
  it('deux onglets qui rafraîchissent en même temps font deux POST séquentiels, un token distinct chacun', async () => {
    stubLockManager();
    const calls = stubRefreshFetch(20);

    vi.resetModules();
    const tabA = await import('./api');
    vi.resetModules();
    const tabB = await import('./api');

    // Synchrone, sans `await` entre les deux : les deux onglets demandent le
    // verrou avant que l'un ou l'autre n'ait pu terminer — exactement la
    // course décrite par le ticket (réouverture du navigateur, N onglets qui
    // démarrent `init()` en même temps).
    const pA = tabA.tryRefresh();
    const pB = tabB.tryRefresh();
    const [outcomeA, outcomeB] = await Promise.all([pA, pB]);

    expect(outcomeA).toEqual({ ok: true });
    expect(outcomeB).toEqual({ ok: true });
    // Verrou pur, sans saut : les DEUX onglets appellent réellement le
    // réseau, à leur tour — jamais un rejeu de l'ancien token.
    const refreshed = refreshCalls(calls);
    expect(refreshed).toHaveLength(2);
    // Chaque onglet obtient SON PROPRE access token — pas de session locale
    // qui reste périmée après le refresh (cf. régression corrigée en revue :
    // un onglet sans token neuf prenait un 401 sur son appel suivant).
    expect(tabA.getAccessToken()).not.toBeNull();
    expect(tabB.getAccessToken()).not.toBeNull();
    expect(tabA.getAccessToken()).not.toBe(tabB.getAccessToken());
    // La 2e requête n'est partie qu'après la résolution complète de la 1re
    // (latence de 20 ms simulée dans `stubRefreshFetch`) : c'est bien une
    // file, pas un tir groupé.
    expect(refreshed[1]!.resolvedAt - refreshed[0]!.resolvedAt).toBeGreaterThanOrEqual(15);
  });
});

describe('tryRefresh — sans navigator.locks (vieux navigateur, ou contexte non sécurisé)', () => {
  it('chaque onglet rafraîchit indépendamment, sans erreur', async () => {
    // `navigator.locks` est déjà absent sous jsdom par défaut (vérifié :
    // aucun stub ici) — le comportement attendu est celui d'avant ce ticket.
    const calls = stubRefreshFetch();

    vi.resetModules();
    const tabA = await import('./api');
    vi.resetModules();
    const tabB = await import('./api');

    const [outcomeA, outcomeB] = await Promise.all([tabA.tryRefresh(), tabB.tryRefresh()]);

    expect(outcomeA).toEqual({ ok: true });
    expect(outcomeB).toEqual({ ok: true });
    expect(refreshCalls(calls)).toHaveLength(2);
  });
});

describe('tryRefresh — mode natif : pas de verrou requis', () => {
  it('ne prend pas le verrou cross-onglet même si navigator.locks existe', async () => {
    const manager = stubLockManager();
    const calls = stubRefreshFetch();
    window.__TAURI_INTERNALS__ = {};
    setRefreshToken('refresh-initial', false);

    const outcome = await tryRefresh();

    expect(outcome).toEqual({ ok: true });
    expect(manager.request).not.toHaveBeenCalled();
    expect(refreshCalls(calls)).toHaveLength(1);
  });
});
