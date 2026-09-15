/**
 * Tests du client HTTP — contrat d'erreur.
 *
 * Le backend sérialise TOUTES ses erreurs sous l'enveloppe
 * `{ error: { code, message, details, requestId } }` (cf.
 * `packages/backend/src/core/error-handler.ts`, `buildResponse`). Le client
 * doit donc déballer `error` avant de construire l'`ApiError` : sinon
 * `ApiError.code` vaut `undefined` et tous les `err.code === '...'` des
 * écrans (LoginScreen, RegisterScreen, ResetPasswordScreen, SettingsScreen)
 * sont morts silencieusement.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

import { ApiError, api, setAccessToken, setOnAuthExpired } from './api';

function mockJsonResponse(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
    }),
  );
}

/** Répond dans l'ordre : la 1re réponse au 1er appel, la 2e au 2e… */
function mockJsonResponses(responses: { status: number; body: unknown }[]) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(r.body),
    });
  }
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
  setOnAuthExpired(null);
  setAccessToken(null);
});

describe('api — enveloppe d’erreur backend', () => {
  it('test_api_error_code_extracted_from_backend_envelope', async () => {
    mockJsonResponse(400, {
      error: {
        code: 'AUTH_RESET_TOKEN_INVALID',
        message: 'Password reset token is invalid, expired or already used',
        details: null,
        requestId: 'req-1',
      },
    });

    const err = await api({
      method: 'POST',
      path: '/auth/reset-password',
      body: { token: 't', newPassword: 'x' },
      unauthenticated: true,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).code).toBe('AUTH_RESET_TOKEN_INVALID');
    expect((err as ApiError).message).toBe(
      'Password reset token is invalid, expired or already used',
    );
  });

  it('test_api_error_accepts_flat_payload', async () => {
    mockJsonResponse(403, { code: 'AUTH_CSRF_MISMATCH', message: 'CSRF token mismatch' });

    const err = (await api({ path: '/me' }).catch((e: unknown) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('AUTH_CSRF_MISMATCH');
  });

  it('test_api_error_falls_back_when_body_is_not_a_typed_error', async () => {
    // Corps HTML (page d'erreur d'un proxy) : pas de JSON parsable côté
    // client → code de repli, jamais `undefined`.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: () => Promise.reject(new Error('not json')),
      }),
    );

    const err = (await api({ path: '/me' }).catch((e: unknown) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.message).toBe('HTTP 502');
  });
});

describe('api — hook onAuthExpired', () => {
  // Le hook reçoit l'erreur qui a fait échouer le refresh, pour que le
  // receveur (`auth.ts`) puisse distinguer un refus du serveur — session
  // morte, l'appareil lâche son push — d'une coupure transitoire qui laisse
  // le cookie de refresh valide (cf. ticket 686f4eea).
  it('reçoit le 401 du refresh quand le serveur refuse la session', async () => {
    const onExpired = vi.fn();
    setOnAuthExpired(onExpired);
    setAccessToken('access-perime');
    mockJsonResponses([
      { status: 401, body: { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired' } } },
      { status: 401, body: { error: { code: 'AUTH_TOKEN_INVALID', message: 'Token invalid' } } },
    ]);

    await expect(api({ path: '/me' })).rejects.toBeInstanceOf(ApiError);

    expect(onExpired).toHaveBeenCalledTimes(1);
    const cause = onExpired.mock.calls[0]?.[0] as ApiError;
    expect(cause).toBeInstanceOf(ApiError);
    expect(cause.status).toBe(401);
    expect(cause.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('reçoit le 5xx du refresh tel quel, sans le maquiller en 401', async () => {
    // Déploiement en cours : le reverse proxy répond 502 au refresh. Le hook
    // tire quand même (comportement préexistant — l'app renvoie vers /login),
    // mais la cause dit au receveur que la session n'a PAS été refusée.
    const onExpired = vi.fn();
    setOnAuthExpired(onExpired);
    setAccessToken('access-perime');
    mockJsonResponses([
      { status: 401, body: { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired' } } },
      { status: 502, body: null },
    ]);

    await expect(api({ path: '/me' })).rejects.toBeInstanceOf(ApiError);

    expect(onExpired).toHaveBeenCalledTimes(1);
    const cause = onExpired.mock.calls[0]?.[0] as ApiError;
    expect(cause).toBeInstanceOf(ApiError);
    expect(cause.status).toBe(502);
  });
});
