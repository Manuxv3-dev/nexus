/**
 * `init()` en mode natif : un démarrage hors-ligne ne coûte pas la session
 * (cf. ticket 17d116dc).
 *
 * Au démarrage, `init()` relit le refresh token au magasin de secrets de l'OS
 * (ADR-038) et tente un refresh. Sur TOUTE erreur — coupure réseau comprise —
 * le `catch` faisait `setRefreshToken(null)`, qui **persiste** : le token
 * était effacé du magasin. Une app desktop ouverte hors-ligne (avion, Wi-Fi
 * qui traîne au réveil) perdait donc sa session pour de bon — écran de
 * connexion au retour du réseau. Déclenché pour de vrai le 2026-09-15 par un
 * `tauri-dev` lancé sans backend.
 *
 * Seul un refus du serveur (401 : expiré, révoqué, réutilisé) dit « ce token
 * est mort ». Tout le reste vide l'état mémoire — on ne peut pas être
 * connecté sans serveur — mais laisse le magasin intact : le prochain
 * lancement retentera.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api, getRefreshToken } from './api';
import type * as ApiModule from './api';
import { useAuth } from './auth';
import { clearSecureToken, writeSecureToken } from './tauri';
import type * as TauriModule from './tauri';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

vi.mock('./push', () => ({
  dropDevicePushSubscription: vi.fn().mockResolvedValue(undefined),
  unsubscribeFromPush: vi.fn().mockResolvedValue(undefined),
}));

// Mode natif : le token vient du magasin, et c'est l'effacement du magasin
// qu'on surveille. `isTauri` réel lirait `window.__TAURI_INTERNALS__` ; on
// force la branche plutôt que de simuler le runtime.
vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return {
    ...actual,
    isTauri: () => true,
    readSecureToken: vi.fn().mockResolvedValue('refresh-du-magasin'),
    writeSecureToken: vi.fn().mockResolvedValue(undefined),
    clearSecureToken: vi.fn().mockResolvedValue(undefined),
  };
});

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(clearSecureToken).mockClear();
  vi.mocked(writeSecureToken).mockClear();
  useAuth.setState({ user: null, initializing: true });
});

describe('init() natif — refresh refusé ou simplement impossible', () => {
  it('coupure réseau : la session mémoire tombe, le magasin garde le token', async () => {
    vi.mocked(api).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await useAuth.getState().init();

    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().initializing).toBe(false);
    // Plus rien en mémoire — on ne peut pas être connecté sans serveur…
    expect(getRefreshToken()).toBeNull();
    // …mais le magasin n'a pas été touché : le prochain lancement retentera.
    expect(clearSecureToken).not.toHaveBeenCalled();
  });

  it('5xx (déploiement en cours) : même chose', async () => {
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(502, { code: 'UNKNOWN_ERROR', message: 'HTTP 502' }),
    );

    await useAuth.getState().init();

    expect(useAuth.getState().user).toBeNull();
    expect(clearSecureToken).not.toHaveBeenCalled();
  });

  it('refus du serveur (401) : le token est effacé du magasin', async () => {
    // Token expiré, révoqué ou réutilisé : le garder ferait rejouer un token
    // mort à chaque lancement — et un token réutilisé révoque toutes les
    // sessions. Là, effacer est la seule bonne réponse.
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(401, { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired' }),
    );

    await useAuth.getState().init();

    expect(useAuth.getState().user).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(clearSecureToken).toHaveBeenCalledTimes(1);
  });
});
