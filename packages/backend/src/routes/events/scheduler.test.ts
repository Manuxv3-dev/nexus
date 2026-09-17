/**
 * Tests unitaires du scheduler `event-reminders`.
 *
 * On mock `getEventRemindersQueue` pour vérifier les `add`/`remove` sans
 * dépendre de Redis, mais on garde le reste de `workers/queues.js` réel
 * (`importOriginal`) — en particulier `addWithTimeout`, dont le test de
 * timeout ci-dessous a besoin du vrai comportement (course contre un
 * `setTimeout` réel), pas d'un stub qui le contournerait. Les helpers
 * exposés par le scheduler (`reminderJobId`, `scheduleEventReminders`,
 * `cancelEventReminders`, `rescheduleEventReminders`) sont testés isolément.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueuesModule from '../../workers/queues.js';

const queueAddMock = vi.fn();
const queueRemoveMock = vi.fn();
// `vi.hoisted` : contrairement à `queueAddMock`/`queueRemoveMock` (référencés
// dans une closure imbriquée, donc évalués tardivement), `loggerWarnMock` est
// assigné directement dans l'objet retourné par le factory `vi.mock` du
// logger — sans `vi.hoisted`, cette assignation s'exécute AVANT sa propre
// déclaration `const` (les appels `vi.mock` sont hoistés au-dessus de tout
// le fichier), d'où une `ReferenceError` de TDZ.
const { loggerWarnMock } = vi.hoisted(() => ({ loggerWarnMock: vi.fn() }));

vi.mock('../../workers/queues.js', async (importOriginal) => {
  const actual = await importOriginal<typeof QueuesModule>();
  return {
    ...actual,
    getEventRemindersQueue: () => ({
      add: queueAddMock,
      remove: queueRemoveMock,
    }),
  };
});

vi.mock('../../core/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
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
  loggerWarnMock.mockReset();
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
    await expect(scheduleEventReminders({ id: 'evt-5', startsAt })).resolves.toBeUndefined();
    // Le 2e tier doit être tenté malgré l'échec du 1er
    expect(queueAddMock).toHaveBeenCalledTimes(2);
  });

  it('résout en moins de 2.5s et logge un warn si `add` ne résout jamais (Redis injoignable, revue ticket 97ad8728)', async () => {
    // Timers réels : ce test mesure un vrai délai d'horloge murale contre le
    // timeout interne d'`addWithTimeout` (2s, cf. `workers/queues.ts`) — les
    // fake timers du `beforeEach` n'avanceraient pas le `setTimeout` interne.
    vi.useRealTimers();
    // Reproduit le comportement réel constaté empiriquement en revue de
    // `505c6a76` (port fermé) : `queue.add` ne rejette JAMAIS quand Redis
    // est injoignable, il pend indéfiniment.
    queueAddMock.mockImplementation(() => new Promise(() => undefined));
    // Un seul tier programmé (delay entre 1h et 24h) pour isoler un seul
    // appel `add` — sinon les deux tiers attendraient chacun leur propre
    // timeout de 2s l'un après l'autre (séquentiel), dépassant 2.5s au total.
    const startsAt = new Date(Date.now() + 6 * 60 * 60 * 1000);

    const start = Date.now();
    await expect(scheduleEventReminders({ id: 'evt-timeout', startsAt })).resolves.toBeUndefined();
    const elapsed = Date.now() - start;

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(2_500);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-timeout', tier: 'h1' }),
      '[event-reminders] failed to schedule tier',
    );
  }, 5_000);
});

describe('cancelEventReminders', () => {
  it('remove les 2 jobs (h24 + h1) avec les ids déterministes', async () => {
    await cancelEventReminders('evt-99');
    expect(queueRemoveMock).toHaveBeenCalledTimes(2);
    expect(queueRemoveMock).toHaveBeenCalledWith('event-reminder:evt-99:h24');
    expect(queueRemoveMock).toHaveBeenCalledWith('event-reminder:evt-99:h1');
  });

  it('avale les erreurs (job déjà exécuté ou inexistant)', async () => {
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
