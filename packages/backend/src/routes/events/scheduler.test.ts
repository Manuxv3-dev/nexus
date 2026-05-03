/**
 * Tests unitaires du scheduler `event-reminders`.
 *
 * On mock entièrement `workers/queues.js` pour vérifier les `add`/`remove`
 * sans dépendre de Redis. Les helpers exposés par le scheduler (`reminderJobId`,
 * `scheduleEventReminders`, `cancelEventReminders`, `rescheduleEventReminders`)
 * sont testés isolément.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queueAddMock = vi.fn();
const queueRemoveMock = vi.fn();

vi.mock('../../workers/queues.js', () => ({
  getEventRemindersQueue: () => ({
    add: queueAddMock,
    remove: queueRemoveMock,
  }),
  QUEUE_NAMES: { EVENT_REMINDERS: 'event-reminders' },
  createQueueConnection: () => ({}),
}));

vi.mock('../../core/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

import {
  cancelEventReminders,
  reminderJobId,
  rescheduleEventReminders,
  scheduleEventReminders,
} from './scheduler.js';

const FIXED_NOW = new Date('2026-06-01T10:00:00.000Z').getTime();

beforeEach(() => {
  queueAddMock.mockReset();
  queueRemoveMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('reminderJobId', () => {
  it('génère un id déterministe par (eventId, tier)', () => {
    expect(reminderJobId('evt-123', 'h24')).toBe('event-reminder:evt-123:h24');
    expect(reminderJobId('evt-123', 'h1')).toBe('event-reminder:evt-123:h1');
    expect(reminderJobId('evt-456', 'h24')).toBe('event-reminder:evt-456:h24');
  });
});

describe('scheduleEventReminders', () => {
  it("programme les 2 tiers quand l'event est >24h dans le futur", async () => {
    const startsAt = new Date(FIXED_NOW + 48 * 60 * 60 * 1000); // +48h
    await scheduleEventReminders({ id: 'evt-1', startsAt });

    expect(queueAddMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenNthCalledWith(
      1,
      'event-reminder',
      { eventId: 'evt-1', tier: 'h24' },
      { jobId: 'event-reminder:evt-1:h24', delay: 24 * 60 * 60 * 1000 },
    );
    expect(queueAddMock).toHaveBeenNthCalledWith(
      2,
      'event-reminder',
      { eventId: 'evt-1', tier: 'h1' },
      { jobId: 'event-reminder:evt-1:h1', delay: 47 * 60 * 60 * 1000 },
    );
  });

  it("ne programme que h1 quand l'event est entre 1h et 24h", async () => {
    const startsAt = new Date(FIXED_NOW + 6 * 60 * 60 * 1000); // +6h
    await scheduleEventReminders({ id: 'evt-2', startsAt });

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledWith(
      'event-reminder',
      { eventId: 'evt-2', tier: 'h1' },
      { jobId: 'event-reminder:evt-2:h1', delay: 5 * 60 * 60 * 1000 },
    );
  });

  it("ne programme aucun tier quand l'event est dans <1h", async () => {
    const startsAt = new Date(FIXED_NOW + 30 * 60 * 1000); // +30 min
    await scheduleEventReminders({ id: 'evt-3', startsAt });
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("ne programme aucun tier quand l'event est dans le passé", async () => {
    const startsAt = new Date(FIXED_NOW - 60 * 60 * 1000); // -1h
    await scheduleEventReminders({ id: 'evt-4', startsAt });
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("avale les erreurs d'enqueue (best-effort, ne fail pas la mutation)", async () => {
    queueAddMock.mockRejectedValueOnce(new Error('redis down'));
    const startsAt = new Date(FIXED_NOW + 48 * 60 * 60 * 1000);
    await expect(
      scheduleEventReminders({ id: 'evt-5', startsAt }),
    ).resolves.toBeUndefined();
    // Le 2e tier doit être tenté malgré l'échec du 1er
    expect(queueAddMock).toHaveBeenCalledTimes(2);
  });
});

describe('cancelEventReminders', () => {
  it('remove les 2 jobs (h24 + h1) avec les ids déterministes', async () => {
    await cancelEventReminders('evt-99');
    expect(queueRemoveMock).toHaveBeenCalledTimes(2);
    expect(queueRemoveMock).toHaveBeenCalledWith('event-reminder:evt-99:h24');
    expect(queueRemoveMock).toHaveBeenCalledWith('event-reminder:evt-99:h1');
  });

  it("avale les erreurs (job déjà exécuté ou inexistant)", async () => {
    queueRemoveMock.mockRejectedValue(new Error('not found'));
    await expect(cancelEventReminders('evt-x')).resolves.toBeUndefined();
  });
});

describe('rescheduleEventReminders', () => {
  it('cancel puis schedule (séquence stricte)', async () => {
    const startsAt = new Date(FIXED_NOW + 48 * 60 * 60 * 1000);

    const order: string[] = [];
    queueRemoveMock.mockImplementation(() => {
      order.push('remove');
      return Promise.resolve();
    });
    queueAddMock.mockImplementation(() => {
      order.push('add');
      return Promise.resolve();
    });

    await rescheduleEventReminders({ id: 'evt-7', startsAt });

    expect(queueRemoveMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenCalledTimes(2);
    // Les 2 remove arrivent strictement avant les 2 add
    expect(order).toEqual(['remove', 'remove', 'add', 'add']);
  });
});
