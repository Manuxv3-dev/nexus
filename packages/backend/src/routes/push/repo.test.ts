/**
 * Tests unitaires de `sendPushToUser` (cf. MAN-142, phase 1 de MAN-24
 * « notifications push PWA »).
 *
 * `web-push`, `getDb` et `loadEnv` sont mockés pour isoler la logique du
 * repo — pas de Postgres ni de vrai push service requis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]): unknown => sendNotificationMock(...args),
    setVapidDetails: (...args: unknown[]): unknown => setVapidDetailsMock(...args),
  },
}));

vi.mock('../../core/env.js', () => ({
  loadEnv: (): Record<string, string> => ({
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
  }),
}));

vi.mock('../../core/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

const whereMock = vi.fn();
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));
const getDbMock = vi.fn(() => ({ select: selectMock }));

vi.mock('../../db/client.js', () => ({
  getDb: (): unknown => getDbMock(),
}));

import { sendPushToUser } from './repo.js';

function makeSub(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id: 'sub-1',
    userId: 'user-1',
    endpoint: 'https://push.example.com/sub-1',
    p256dh: 'p256dh-1',
    auth: 'auth-1',
    ...overrides,
  };
}

beforeEach(() => {
  sendNotificationMock.mockReset();
  setVapidDetailsMock.mockReset();
  whereMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('sendPushToUser', () => {
  it('appelle webpush.sendNotification pour chaque souscription du user', async () => {
    whereMock.mockResolvedValue([
      makeSub({ id: 'sub-1', endpoint: 'https://push.example.com/1' }),
      makeSub({ id: 'sub-2', endpoint: 'https://push.example.com/2' }),
    ]);
    sendNotificationMock.mockResolvedValue(undefined);

    await sendPushToUser('user-1', { kind: 'todo_assigned', payload: {} });

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const endpoints = sendNotificationMock.mock.calls.map(
      (c) => (c[0] as { endpoint: string }).endpoint,
    );
    expect(new Set(endpoints)).toEqual(
      new Set(['https://push.example.com/1', 'https://push.example.com/2']),
    );
  });

  it('ne fait rien si le user n’a aucune souscription', async () => {
    whereMock.mockResolvedValue([]);

    await sendPushToUser('user-1', { kind: 'todo_assigned', payload: {} });

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('ne relance jamais quand webpush.sendNotification échoue', async () => {
    whereMock.mockResolvedValue([makeSub()]);
    sendNotificationMock.mockRejectedValue(new Error('push service down'));

    await expect(
      sendPushToUser('user-1', { kind: 'todo_assigned', payload: {} }),
    ).resolves.toBeUndefined();
  });
});
