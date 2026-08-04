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

import { sendPushToUser, sendPushToUsers } from './repo.js';

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
  selectMock.mockClear();
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

describe('sendPushToUsers', () => {
  it("ne fait qu'UNE requête push_subscriptions pour tout le lot (pas de N+1)", async () => {
    whereMock.mockResolvedValue([
      makeSub({ id: 'sub-a', userId: 'user-a', endpoint: 'https://push.example.com/a' }),
      makeSub({ id: 'sub-b', userId: 'user-b', endpoint: 'https://push.example.com/b' }),
    ]);
    sendNotificationMock.mockResolvedValue(undefined);

    await sendPushToUsers([
      { userId: 'user-a', kind: 'event_reminder' },
      { userId: 'user-b', kind: 'event_reminder' },
    ]);

    // Le fan-out d'un rappel à tout un groupe passe par là : une requête par
    // destinataire serait un N+1 sur le chemin d'une requête HTTP métier.
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
  });

  it('no-op sans requête DB quand la liste de targets est vide', async () => {
    await sendPushToUsers([]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});

/**
 * Enrichissement du payload push avec `data.{groupId,pane,sourceId}` pour le
 * deep-link au clic (cf. MAN-143 Phase 2). `pane` vient de
 * `notificationKindToPane` (@nexus/shared) — la Task 3 (service worker) lira
 * ce champ pour router le clic vers le bon panel.
 */
describe('sendPushToUser — payload data (deep-link)', () => {
  function lastPayload(): { title: string; body: string; data: unknown } {
    const call = sendNotificationMock.mock.calls.at(-1) as [unknown, string];
    return JSON.parse(call[1]) as { title: string; body: string; data: unknown };
  }

  it('test_push_payload_includes_groupId_pane_sourceId', async () => {
    whereMock.mockResolvedValue([makeSub()]);
    sendNotificationMock.mockResolvedValue(undefined);

    await sendPushToUser('user-1', {
      kind: 'todo_assigned',
      payload: {},
      groupId: 'group-1',
      sourceId: 'todo-item-1',
    });

    expect(lastPayload().data).toEqual({
      groupId: 'group-1',
      pane: 'todo',
      sourceId: 'todo-item-1',
    });
  });

  it.each([
    ['event_reminder', 'event'],
    ['expense_added', 'expense'],
    ['todo_completed', 'todo'],
  ])('test_push_payload_for_each_kind_matches_mapping: %s -> %s', async (kind, expectedPane) => {
    whereMock.mockResolvedValue([makeSub()]);
    sendNotificationMock.mockResolvedValue(undefined);

    await sendPushToUser('user-1', {
      kind,
      payload: {},
      groupId: 'group-1',
      sourceId: 'src-1',
    });

    expect(lastPayload().data).toMatchObject({ pane: expectedPane });
  });

  it('test_push_payload_no_groupId_omits_it_gracefully', async () => {
    whereMock.mockResolvedValue([makeSub()]);
    sendNotificationMock.mockResolvedValue(undefined);

    await sendPushToUser('user-1', {
      kind: 'todo_assigned',
      payload: {},
      groupId: null,
      sourceId: 'todo-item-1',
    });

    const payload = lastPayload();
    expect(payload).toBeTruthy();
    expect((payload.data as { groupId: unknown }).groupId).toBeNull();
  });
});
