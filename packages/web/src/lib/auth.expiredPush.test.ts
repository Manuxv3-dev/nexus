/**
 * Une session qui tombe SANS logout lâche l'abonnement push de l'appareil
 * (cf. ticket 686f4eea, lacune assumée de 35c39b3a).
 *
 * `logout()` désabonne l'appareil pendant que le token est encore posé
 * (`unsubscribeFromPush` : DELETE serveur puis `subscription.unsubscribe()`).
 * Une session qui expire n'a pas ce luxe : le token est déjà mort, le DELETE
 * partirait en 401. Sans rien faire, la ligne `push_subscriptions` reste
 * attachée à A et ses notifications — avec aperçu — continuent d'arriver sur
 * la machine, application fermée comprise, jusqu'à ce que B active le push à
 * la main.
 *
 * Le correctif est côté navigateur seulement (`dropDevicePushSubscription`) :
 * l'endpoint meurt, le push service répond 404/410 au prochain envoi et le
 * backend élague la ligne. Même coût pour A qu'un logout — il réactive le
 * push dans les Réglages — et la fenêtre se ferme à l'expiration, pas à la
 * connexion du suivant.
 *
 * Deux chemins font tomber une session sans logout : le hook
 * `setOnAuthExpired` (refresh échoué en cours de session) et le `catch` de
 * `init()` (refresh refusé au démarrage). Les deux partagent le même
 * prédicat, et ne déclenchent que sur un **401** — le seul code par lequel le
 * serveur dit « session morte ». Une erreur réseau (PWA hors-ligne) ou un 5xx
 * (déploiement en cours) laissent le cookie de refresh valide : l'app renvoie
 * vers /login mais se reconnectera au prochain chargement — lâcher le push là
 * serait une perte silencieuse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api, getAccessToken, setAccessToken } from './api';
import type * as ApiModule from './api';
import { type User, useAuth } from './auth';
import { dropDevicePushSubscription, unsubscribeFromPush } from './push';
import type * as TauriModule from './tauri';

// `vi.mock` et `vi.hoisted` sont remontés au-dessus des imports par vitest :
// les déclarer après eux, comme le fait le reste du repo, garde le bloc
// d'imports d'un seul tenant.
const { authExpired } = vi.hoisted(() => ({
  authExpired: { current: null as ((cause: unknown) => void) | null },
}));

// `auth.ts` branche son hook 401 à l'import via `setOnAuthExpired` : on
// l'intercepte pour pouvoir simuler l'expiration sans rejouer tout le circuit
// fetch → 401 → refresh → 401 de `api.ts`, déjà couvert par `api.test.ts`.
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    api: vi.fn(),
    setOnAuthExpired: vi.fn((handler: ((cause: unknown) => void) | null) => {
      authExpired.current = handler;
      actual.setOnAuthExpired(handler);
    }),
  };
});

vi.mock('./push', () => ({
  dropDevicePushSubscription: vi.fn().mockResolvedValue(undefined),
  unsubscribeFromPush: vi.fn().mockResolvedValue(undefined),
}));

// `./api` consomme d'autres exports de `./tauri` : on part du module réel et
// on n'override que ce dont le test a besoin.
vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, isTauri: () => false };
});

/** Laisse retomber les promesses lancées en fire-and-forget par le hook. */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Ce que `/auth/refresh` renvoie pour un token expiré, révoqué ou réutilisé. */
const sessionRejected = () =>
  new ApiError(401, { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired' });

beforeEach(() => {
  vi.mocked(dropDevicePushSubscription).mockClear().mockResolvedValue(undefined);
  vi.mocked(unsubscribeFromPush).mockClear();
  vi.mocked(api).mockReset();
  setAccessToken('token-de-A');
  useAuth.setState({
    user: { id: '00000000-0000-4000-8000-000000000001' } as unknown as User,
    initializing: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('expiration de session — désabonnement push', () => {
  it('le hook 401 lâche l’abonnement de l’appareil, sans DELETE serveur', async () => {
    expect(authExpired.current).not.toBeNull();

    authExpired.current?.(sessionRejected());
    await flushMicrotasks();

    expect(dropDevicePushSubscription).toHaveBeenCalledTimes(1);
    // Aucun token n'est plus valide : un DELETE partirait en 401 et ne
    // supprimerait rien. Le chemin authentifié n'a rien à faire ici.
    expect(unsubscribeFromPush).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('le hook ne lâche pas l’abonnement sur un refresh tombé en 5xx', async () => {
    // Déploiement en cours : le 401 initial prouve que le serveur répondait,
    // mais le refresh a pris un 502 du reverse proxy. Le cookie de refresh est
    // intact, la session reviendra au prochain chargement — le push doit
    // survivre, exactement comme pour l'erreur réseau de `init()` ci-dessous.
    authExpired.current?.(new ApiError(502, { code: 'UNKNOWN_ERROR', message: 'HTTP 502' }));
    await flushMicrotasks();

    expect(dropDevicePushSubscription).not.toHaveBeenCalled();
    // Le reset de session, lui, a bien lieu (comportement préexistant).
    expect(getAccessToken()).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('un désabonnement qui échoue ne casse pas le hook', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = new Error('service worker absent');
    vi.mocked(dropDevicePushSubscription).mockRejectedValueOnce(failure);

    expect(() => authExpired.current?.(sessionRejected())).not.toThrow();
    await flushMicrotasks();

    // La session est bien fermée quoi qu'il arrive au push, et l'échec est
    // journalisé plutôt que laissé en rejet non géré.
    expect(getAccessToken()).toBeNull();
    expect(useAuth.getState().user).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("l'expiration de session"), failure);
  });

  it('init() : un refresh refusé (401) au démarrage lâche l’abonnement', async () => {
    vi.mocked(api).mockRejectedValueOnce(sessionRejected());

    await useAuth.getState().init();
    await flushMicrotasks();

    expect(dropDevicePushSubscription).toHaveBeenCalledTimes(1);
    expect(unsubscribeFromPush).not.toHaveBeenCalled();
    expect(useAuth.getState().user).toBeNull();
  });

  it('init() : une erreur réseau au démarrage ne touche pas à l’abonnement', async () => {
    // PWA ouverte hors-ligne : le cookie de refresh est toujours valide, la
    // session reviendra au prochain chargement. Lâcher le push ici serait une
    // perte silencieuse — l'utilisateur se retrouverait connecté sans push,
    // sans avoir rien demandé.
    vi.mocked(api).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await useAuth.getState().init();
    await flushMicrotasks();

    expect(dropDevicePushSubscription).not.toHaveBeenCalled();
    expect(useAuth.getState().user).toBeNull();
  });
});
