/**
 * Mode natif desktop (cf. ADR-038) — phase 1 : bascule du mode client.
 *
 * Sur desktop, le front est servi depuis `http://tauri.localhost` et appelle
 * l'API sur `https://api.nexusapp.chat` : c'est cross-site, et le cookie de
 * refresh posé en `SameSite=Strict` n'est donc jamais renvoyé. La session ne
 * survit pas au redémarrage.
 *
 * Le backend sait déjà servir le mode natif — le refresh token transite alors
 * dans le corps de la requête et de la réponse. Le seul verrou était
 * `X-Nexus-Client: 'web'` envoyé en dur pour toutes les cibles, qui forçait le
 * backend en mode cookie même sur desktop.
 *
 * Cette phase ne persiste rien encore : le token vit en mémoire. Elle rend la
 * session résistante à une expiration d'access token, pas à un redémarrage.
 *
 * Le test le plus important est celui de la **rotation** : `/auth/refresh`
 * renvoie un nouveau refresh token et révoque l'ancien. Un client qui ne
 * garderait pas le nouveau rejouerait l'ancien au refresh suivant, ce que le
 * backend interprète comme un vol de token (`AUTH_REFRESH_REUSED`) — et qui
 * **révoque toutes les sessions de l'utilisateur**. Perdre la rotation est
 * donc pire que de ne rien faire.
 */

import { invoke } from '@tauri-apps/api/core';
import type * as TauriCoreModule from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, setAccessToken, setRefreshToken, getRefreshToken } from './api';

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriCoreModule>();
  return { ...actual, invoke: vi.fn() };
});

const invokeSpy = vi.mocked(invoke);

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Capture les appels et répond selon une file de réponses. */
function stubFetch(responses: { status: number; body: unknown }[]): FetchCall[] {
  const calls: FetchCall[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return Promise.resolve({
        ok: r!.status >= 200 && r!.status < 300,
        status: r!.status,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(r!.body),
      });
    }),
  );
  return calls;
}

function headerOf(call: FetchCall, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  // `RequestInit['body']` est un union large (Blob, FormData…) ; ici c'est
  // toujours la chaîne JSON produite par `rawFetch`, d'où le garde-fou plutôt
  // qu'un `String()` qui stringifierait un objet en « [object Object] ».
  const raw = call.init.body;
  return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Effacer AVANT de retirer le marqueur Tauri, sinon le nettoyage lui-même
  // déclencherait une écriture au magasin depuis un test suivant.
  setRefreshToken(null);
  delete window.__TAURI_INTERNALS__;
  setAccessToken(null);
  invokeSpy.mockReset();
});

describe('api — mode client selon la cible', () => {
  it('annonce `web` en navigateur, pour garder le cookie + CSRF d’ADR-015', () => {
    const calls = stubFetch([{ status: 200, body: { ok: true } }]);

    return api({ path: '/me', unauthenticated: true }).then(() => {
      expect(headerOf(calls[0]!, 'X-Nexus-Client')).toBe('web');
    });
  });

  it('annonce `native` sous Tauri, pour que le token transite en body', async () => {
    window.__TAURI_INTERNALS__ = {};
    const calls = stubFetch([{ status: 200, body: { ok: true } }]);

    await api({ path: '/me', unauthenticated: true });

    expect(headerOf(calls[0]!, 'X-Nexus-Client')).toBe('native');
  });
});

describe('api — refresh transparent en mode natif', () => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
  });

  it('envoie le refresh token en body, faute de cookie utilisable', async () => {
    setRefreshToken('refresh-initial');
    const calls = stubFetch([
      { status: 401, body: { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } } },
      { status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2' } },
      { status: 200, body: { ok: true } },
    ]);

    await api({ path: '/me' });

    const refreshCall = calls.find((c) => c.url.includes('/auth/refresh'));
    expect(refreshCall).toBeDefined();
    expect(bodyOf(refreshCall!).refreshToken).toBe('refresh-initial');
  });

  it('conserve le token roté — sinon le backend révoque toutes les sessions', async () => {
    setRefreshToken('refresh-initial');
    stubFetch([
      { status: 401, body: { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } } },
      { status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2' } },
      { status: 200, body: { ok: true } },
    ]);

    await api({ path: '/me' });

    // Rejouer `refresh-initial` au prochain refresh serait lu comme un vol de
    // token (`AUTH_REFRESH_REUSED`) et déconnecterait l'utilisateur partout.
    expect(getRefreshToken()).toBe('refresh-2');
  });

  it('ne tente pas de refresh sans token en mémoire', async () => {
    setRefreshToken(null);
    const calls = stubFetch([
      { status: 401, body: { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } } },
    ]);

    await api({ path: '/me' }).catch(() => undefined);

    // Sans token, l'appel ne peut qu'échouer : le faire quand même produit un
    // 401 de plus et brouille les logs serveur pour rien.
    expect(calls.some((c) => c.url.includes('/auth/refresh'))).toBe(false);
  });
});

describe('api — persistance du refresh token (ADR-038, phase 3)', () => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
  });

  it('persiste le token roté sans que le point d’appel ait à y penser', async () => {
    setRefreshToken('refresh-initial');
    invokeSpy.mockClear();
    stubFetch([
      { status: 401, body: { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } } },
      { status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2' } },
      { status: 200, body: { ok: true } },
    ]);

    await api({ path: '/me' });

    // Le cœur du garde-fou : c'est `setRefreshToken` qui persiste, donc la
    // rotation — le site qu'on risquait le plus d'oublier — est couverte.
    expect(invokeSpy).toHaveBeenCalledWith('secure_token_set', { token: 'refresh-2' });
  });

  it('efface le token du magasin quand on le remet à null', () => {
    setRefreshToken('refresh-initial');
    invokeSpy.mockClear();

    setRefreshToken(null);

    expect(invokeSpy).toHaveBeenCalledWith('secure_token_clear');
  });
});
