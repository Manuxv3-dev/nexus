/**
 * Dédup du refresh entre onglets (Web Locks + marqueur localStorage) —
 * cf. ticket Cortex `b80127ce`.
 *
 * `api.ts` dédoublonnait déjà le refresh concurrent DANS un onglet
 * (`refreshInFlight`), pas ENTRE onglets : le cookie `nexus_refresh` est
 * partagé par le navigateur, et N onglets qui rafraîchissent en même temps
 * (réouverture du navigateur, retour de veille) rejouaient chacun le même
 * token T0 — au-delà de 2 onglets, la fenêtre de grâce d'ADR-040 finit par
 * révoquer TOUTE la session utilisateur (`AUTH_REFRESH_REUSED`).
 *
 * Deux « onglets » sont simulés ici par deux instances du module `./api`
 * (`vi.resetModules()` + `import()` dynamique) : chacune a son propre état
 * privé (`accessTokenInMemory`, `refreshInFlight`), mais les deux partagent
 * le même `window` jsdom — donc le même `localStorage` (le marqueur
 * cross-onglet) et les mêmes `fetch`/`navigator` globaux, comme deux onglets
 * réels du même navigateur partagent cookies et `localStorage` sans partager
 * leur tas JS. C'est le seul test du repo qui a besoin de `resetModules()`
 * pour de vrai (cf. commentaire contraire dans
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
 * Clé du marqueur cross-onglet — dupliquée depuis `api.ts` (non exportée,
 * c'est un détail d'implémentation ; cf. JSDoc de `readRefreshMarker`).
 */
const REFRESH_MARKER_KEY = 'nexus:refresh:last';

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
}

/** Compte les appels réseau ; répond à chacun avec un accessToken distinct. */
function stubRefreshFetch(): FetchCall[] {
  const calls: FetchCall[] = [];
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push({ url });
      n += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ accessToken: `access-${n}` }),
      });
    }),
  );
  return calls;
}

function refreshCallCount(calls: FetchCall[]): number {
  return calls.filter((c) => c.url.includes('/auth/refresh')).length;
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
    expect(refreshCallCount(calls)).toBe(1);
  });
});

describe('tryRefresh — dédup entre onglets (Web Locks + marqueur localStorage)', () => {
  it('deux onglets qui rafraîchissent en même temps ne font qu’un seul POST', async () => {
    stubLockManager();
    const calls = stubRefreshFetch();

    vi.resetModules();
    const tabA = await import('./api');
    vi.resetModules();
    const tabB = await import('./api');

    // Synchrone, sans `await` entre les deux : les deux onglets lisent le
    // marqueur cross-onglet AVANT que l'un ou l'autre n'ait pu écrire quoi
    // que ce soit — exactement la course décrite par le ticket (réouverture
    // du navigateur, N onglets qui démarrent `init()` en même temps).
    const pA = tabA.tryRefresh();
    const pB = tabB.tryRefresh();
    const [outcomeA, outcomeB] = await Promise.all([pA, pB]);

    expect(outcomeA).toEqual({ ok: true });
    // Le 2e onglet a vu le marqueur changer pendant l'attente du verrou : il
    // saute l'appel réseau et considère la session valide (cf. JSDoc de
    // `withCrossTabRefreshLock` dans api.ts) — son access token restera
    // périmé jusqu'au prochain 401, qui retentera un refresh sous verrou non
    // contesté cette fois.
    expect(outcomeB).toEqual({ ok: true });
    expect(refreshCallCount(calls)).toBe(1);
    expect(window.localStorage.getItem(REFRESH_MARKER_KEY)).not.toBeNull();
  });
});

describe('tryRefresh — sans navigator.locks (vieux navigateur, ou contexte non sécurisé)', () => {
  it('chaque onglet rafraîchit indépendamment, sans dédup ni erreur', async () => {
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
    expect(refreshCallCount(calls)).toBe(2);
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
    expect(refreshCallCount(calls)).toBe(1);
    // Ne doit rien écrire dans localStorage : ADR-038 exclut ce magasin pour
    // le refresh token natif, et le marqueur cross-onglet n'a pas de sens
    // pour une fenêtre unique — cf. JSDoc de `performRefreshRequest`.
    expect(window.localStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
  });
});
