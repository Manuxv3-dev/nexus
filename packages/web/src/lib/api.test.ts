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

import { ApiError, api } from './api';

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

afterEach(() => {
  vi.unstubAllGlobals();
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
