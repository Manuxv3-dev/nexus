/**
 * Tests unitaires de `sendPasswordResetEmail` (MAN-171 phase 1, MAN-166
 * « mot de passe oublié — reset complet »).
 *
 * `resend`, `loadEnv` et `logger` sont mockés pour isoler la logique du
 * module — pas de vrai appel réseau vers l'API Resend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendPasswordResetEmail } from './email.js';
import { AppError } from './errors.js';

// `vi.mock` factories sont hoistées au-dessus des imports/const du fichier :
// les variables qu'elles référencent doivent passer par `vi.hoisted` pour
// exister au moment de l'exécution de la factory (cf. doc vitest).
const { sendMock, ResendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const ResendMock = vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  }));
  return { sendMock, ResendMock };
});

vi.mock('resend', () => ({
  Resend: ResendMock,
}));

const loadEnvMock = vi.hoisted(() => vi.fn());
vi.mock('./env.js', () => ({
  loadEnv: (): unknown => loadEnvMock(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

beforeEach(() => {
  sendMock.mockReset();
  ResendMock.mockClear();
  loadEnvMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('sendPasswordResetEmail', () => {
  it('test_sendPasswordResetEmail_calls_resend_with_correct_params', async () => {
    loadEnvMock.mockReturnValue({
      RESEND_API_KEY: 'test-api-key',
      EMAIL_FROM: 'Nexus <noreply@nexusapp.chat>',
    });
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    await sendPasswordResetEmail('user@example.com', 'https://app.nexusapp.chat/reset/token-123');

    expect(ResendMock).toHaveBeenCalledWith('test-api-key');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0]?.[0] as {
      to: string;
      from: string;
      subject: string;
      html: string;
    };
    expect(call.to).toBe('user@example.com');
    expect(call.from).toBe('Nexus <noreply@nexusapp.chat>');
    expect(call.subject).toContain('mot de passe');
    expect(call.html).toContain('https://app.nexusapp.chat/reset/token-123');
  });

  it('test_throws_when_api_key_missing', async () => {
    loadEnvMock.mockReturnValue({
      RESEND_API_KEY: undefined,
      EMAIL_FROM: 'Nexus <noreply@nexusapp.chat>',
    });

    await expect(
      sendPasswordResetEmail('user@example.com', 'https://app.nexusapp.chat/reset/token-123'),
    ).rejects.toBeInstanceOf(AppError);
    expect(ResendMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('test_throws_when_from_address_missing', async () => {
    loadEnvMock.mockReturnValue({
      RESEND_API_KEY: 'test-api-key',
      EMAIL_FROM: undefined,
    });

    await expect(
      sendPasswordResetEmail('user@example.com', 'https://app.nexusapp.chat/reset/token-123'),
    ).rejects.toBeInstanceOf(AppError);
    expect(ResendMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('test_propagates_resend_errors', async () => {
    loadEnvMock.mockReturnValue({
      RESEND_API_KEY: 'test-api-key',
      EMAIL_FROM: 'Nexus <noreply@nexusapp.chat>',
    });
    sendMock.mockRejectedValue(new Error('network failure'));

    await expect(
      sendPasswordResetEmail('user@example.com', 'https://app.nexusapp.chat/reset/token-123'),
    ).rejects.toThrow('network failure');
  });

  it('test_throws_when_resend_returns_an_api_error', async () => {
    loadEnvMock.mockReturnValue({
      RESEND_API_KEY: 'test-api-key',
      EMAIL_FROM: 'Nexus <noreply@nexusapp.chat>',
    });
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'invalid_api_key', statusCode: 401, message: 'Invalid API key' },
    });

    await expect(
      sendPasswordResetEmail('user@example.com', 'https://app.nexusapp.chat/reset/token-123'),
    ).rejects.toBeInstanceOf(AppError);
  });
});
