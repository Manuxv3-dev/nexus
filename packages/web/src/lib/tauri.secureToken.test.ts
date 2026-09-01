/**
 * Wrappers du magasin de secrets de l'OS (cf. ADR-038, phase 2).
 *
 * Mêmes garanties que les autres wrappers de `tauri.ts` : no-op hors runtime
 * Tauri, délégation directe à la commande Rust sinon.
 *
 * S'y ajoute une garantie propre à ces trois-là, posée par ADR-038 : **un
 * échec de stockage n'est pas un échec d'authentification**. Le magasin n'est
 * pas garanti disponible — une session Linux minimale peut n'avoir aucun
 * Secret Service — et l'indisponibilité doit coûter la persistance, jamais
 * l'accès. Les wrappers absorbent donc l'erreur au lieu de la propager : un
 * `throw` ici remonterait jusqu'au `login()` et empêcherait de se connecter
 * sur une machine où tout fonctionne par ailleurs.
 */
import { invoke } from '@tauri-apps/api/core';
import type * as TauriCoreModule from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readSecureToken, clearSecureToken, writeSecureToken } from './tauri';

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriCoreModule>();
  return { ...actual, invoke: vi.fn() };
});

const mockedInvoke = vi.mocked(invoke);

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  mockedInvoke.mockReset();
});

describe('hors runtime Tauri', () => {
  it('ne touche à rien et ne rend aucun token', async () => {
    expect(await readSecureToken()).toBeNull();
    await writeSecureToken('t');
    await clearSecureToken();

    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe('sous Tauri — chemin nominal', () => {
  it('délègue aux trois commandes Rust', async () => {
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockResolvedValue('refresh-1');

    expect(await readSecureToken()).toBe('refresh-1');
    expect(mockedInvoke).toHaveBeenCalledWith('secure_token_get');

    await writeSecureToken('refresh-2');
    expect(mockedInvoke).toHaveBeenCalledWith('secure_token_set', { token: 'refresh-2' });

    await clearSecureToken();
    expect(mockedInvoke).toHaveBeenCalledWith('secure_token_clear');
  });

  it('rend null quand aucune entrée n’existe encore', async () => {
    window.__TAURI_INTERNALS__ = {};
    // Cas nominal du premier lancement : la commande Rust renvoie `None`, pas
    // une erreur — c'est ce qui distingue « pas de session » de « magasin en
    // panne ».
    mockedInvoke.mockResolvedValue(null);

    expect(await readSecureToken()).toBeNull();
  });
});

describe('sous Tauri — magasin indisponible (ADR-038)', () => {
  it('la lecture rend null au lieu de jeter', async () => {
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockRejectedValue(new Error('magasin de secrets indisponible'));

    await expect(readSecureToken()).resolves.toBeNull();
  });

  it("l'écriture n'échoue pas — sinon un login réussi serait annulé", async () => {
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockRejectedValue(new Error('écriture du token impossible'));

    // La promesse doit se résoudre : l'utilisateur perd la persistance entre
    // deux lancements, pas sa session courante.
    await expect(writeSecureToken('refresh-1')).resolves.toBeUndefined();
  });

  it("l'effacement n'échoue pas — sinon un logout resterait bloqué", async () => {
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockRejectedValue(new Error('suppression du token impossible'));

    await expect(clearSecureToken()).resolves.toBeUndefined();
  });
});
