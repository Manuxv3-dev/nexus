/**
 * Tests unitaires du processor `push-send` (cf. ticket Cortex `505c6a76`).
 *
 * On mock `sendPushToUsers` pour vérifier que le processor lui repasse
 * `job.data.targets` tel quel, que rien n'est catché localement (une erreur
 * de `sendPushToUsers` doit remonter à BullMQ pour déclencher son retry), et
 * que la garde de fraîcheur (`enqueuedAt`/`PUSH_MAX_AGE_MS`, revue perf du
 * ticket) skippe bien un job périmé sans appeler `sendPushToUsers` — sans
 * dépendre de Redis ni d'un vrai push service.
 *
 * Le `main()` du worker est protégé par `isMainModule`, donc l'import du
 * processor depuis ce test ne déclenche pas le bootstrap BullMQ.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const sendPushToUsersMock = vi.fn();

vi.mock('../routes/push/repo.js', () => ({
  sendPushToUsers: (...args: unknown[]): unknown => sendPushToUsersMock(...args),
}));

vi.mock('../core/logger.js', () => {
  const noop = vi.fn();
  const child = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
  return {
    logger: {
      ...child,
      child: () => child,
    },
  };
});

// Stub bullmq pour éviter d'ouvrir une connexion Redis à l'import.
vi.mock('bullmq', () => ({
  Worker: class {},
  Queue: class {},
}));
vi.mock('./queues.js', () => ({
  createQueueConnection: () => ({}),
  QUEUE_NAMES: { PUSH_SEND: 'push-send' },
}));
vi.mock('../bootstrap-env.js', () => ({}));

import { processPushSendJob } from './push-send.js';

interface Target {
  userId: string;
  kind: string;
  groupId: string | null;
  sourceId: string | null;
}

/** `enqueuedAt` par défaut = maintenant (job frais), overridable pour les tests de fraîcheur. */
function makeJob(targets: Target[], enqueuedAt: number = Date.now()) {
  return {
    id: 'job-1',
    name: 'push-send',
    data: { targets, enqueuedAt },
  } as Parameters<typeof processPushSendJob>[0];
}

beforeEach(() => {
  sendPushToUsersMock.mockReset();
});

describe('processPushSendJob', () => {
  it('appelle sendPushToUsers avec job.data.targets tel quel', async () => {
    sendPushToUsersMock.mockResolvedValue(undefined);
    const targets = [
      { userId: 'user-a', kind: 'event_reminder', groupId: 'group-1', sourceId: 'evt-1' },
      { userId: 'user-b', kind: 'todo_assigned', groupId: null, sourceId: null },
    ];

    await processPushSendJob(makeJob(targets));

    expect(sendPushToUsersMock).toHaveBeenCalledTimes(1);
    expect(sendPushToUsersMock).toHaveBeenCalledWith(targets);
  });

  it('laisse remonter une erreur de sendPushToUsers (BullMQ gère le retry)', async () => {
    sendPushToUsersMock.mockRejectedValue(new Error('db down'));

    await expect(
      processPushSendJob(
        makeJob([{ userId: 'user-a', kind: 'event_reminder', groupId: null, sourceId: null }]),
      ),
    ).rejects.toThrow('db down');
  });

  it('gère un lot vide sans planter (no-op côté sendPushToUsers)', async () => {
    sendPushToUsersMock.mockResolvedValue(undefined);

    await processPushSendJob(makeJob([]));

    expect(sendPushToUsersMock).toHaveBeenCalledWith([]);
  });

  it('skip un job périmé (enqueuedAt > 15 min) sans appeler sendPushToUsers', async () => {
    const staleEnqueuedAt = Date.now() - 16 * 60 * 1000; // 16 min — au-delà de PUSH_MAX_AGE_MS
    const targets = [{ userId: 'user-a', kind: 'event_reminder', groupId: null, sourceId: null }];

    await processPushSendJob(makeJob(targets, staleEnqueuedAt));

    expect(sendPushToUsersMock).not.toHaveBeenCalled();
  });

  it('traite un job juste dans la fenêtre de fraîcheur (enqueuedAt à -14 min)', async () => {
    sendPushToUsersMock.mockResolvedValue(undefined);
    const freshEnough = Date.now() - 14 * 60 * 1000; // 14 min — encore sous PUSH_MAX_AGE_MS
    const targets = [{ userId: 'user-a', kind: 'event_reminder', groupId: null, sourceId: null }];

    await processPushSendJob(makeJob(targets, freshEnough));

    expect(sendPushToUsersMock).toHaveBeenCalledWith(targets);
  });
});
