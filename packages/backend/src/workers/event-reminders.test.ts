/**
 * Tests unitaires du processor `event-reminders`.
 *
 * On mock `getEventById`, `listMembers` et `publishNexusEvent` pour
 * vérifier la logique d'audience (filtrage RSVP=`no`), la skip logique
 * (event introuvable, event passé, audience vide) et la shape du WS event
 * publié — sans dépendre de Postgres ni Redis.
 *
 * Le `main()` du worker est protégé par `isMainModule`, donc l'import du
 * processor depuis ce test ne déclenche pas le bootstrap BullMQ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupMember, User } from '../db/schema/index.js';
import type { EventWithRsvps } from '../routes/events/repo.js';

const getEventByIdMock = vi.fn();
const listMembersMock = vi.fn();
const publishNexusEventMock = vi.fn();
const insertNotificationsBulkMock = vi.fn();

vi.mock('../routes/events/repo.js', () => ({
  getEventById: (...args: unknown[]) => getEventByIdMock(...args),
}));

vi.mock('../routes/groups/service.js', () => ({
  listMembers: (...args: unknown[]) => listMembersMock(...args),
}));

vi.mock('../ws/nexus-event-bus.js', () => ({
  publishNexusEvent: (...args: unknown[]) => publishNexusEventMock(...args),
}));

vi.mock('../routes/notifications/repo.js', () => ({
  insertNotificationsBulk: (...args: unknown[]) =>
    insertNotificationsBulkMock(...args),
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

// Stub bullmq + lock pour éviter d'ouvrir une connexion Redis à l'import
vi.mock('bullmq', () => ({
  Worker: class {},
  Queue: class {},
}));
vi.mock('./queues.js', () => ({
  createQueueConnection: () => ({}),
  QUEUE_NAMES: { EVENT_REMINDERS: 'event-reminders' },
}));
vi.mock('./lock.js', () => ({
  acquireLock: vi.fn(),
}));
vi.mock('../bootstrap-env.js', () => ({}));

import { processEventReminderJob } from './event-reminders.js';

const FIXED_NOW = new Date('2026-06-01T10:00:00.000Z').getTime();

function makeJob(eventId: string, tier: 'h24' | 'h1') {
  return {
    id: 'job-1',
    name: 'event-reminder',
    data: { eventId, tier },
  } as Parameters<typeof processEventReminderJob>[0];
}

function makeEvent(overrides: Partial<EventWithRsvps> = {}): EventWithRsvps {
  return {
    id: 'evt-1',
    slug: 'abc',
    groupId: 'group-1',
    tags: [],
    title: 'Apéro',
    description: null,
    startsAt: new Date(FIXED_NOW + 60 * 60 * 1000),
    location: null,
    createdBy: 'user-1',
    createdAt: new Date(FIXED_NOW - 24 * 60 * 60 * 1000),
    updatedAt: new Date(FIXED_NOW - 24 * 60 * 60 * 1000),
    rsvps: [],
    ...overrides,
  };
}

function makeMember(userId: string): { member: GroupMember; user: User } {
  return {
    member: {
      id: `m-${userId}`,
      groupId: 'group-1',
      userId,
      role: 'member',
      joinedAt: new Date(),
    } as GroupMember,
    user: {
      id: userId,
      email: `${userId}@x.test`,
      passwordHash: '',
      displayName: userId,
      avatarUrl: null,
      themePreference: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User,
  };
}

beforeEach(() => {
  getEventByIdMock.mockReset();
  listMembersMock.mockReset();
  publishNexusEventMock.mockReset();
  insertNotificationsBulkMock.mockReset();
  // Default : insertNotificationsBulk renvoie 1 notif par input avec un id stable.
  insertNotificationsBulkMock.mockImplementation(
    async (inputs: { userId: string; kind: string }[]) =>
      inputs.map((i, idx) => ({
        id: `00000000-0000-0000-0000-${String(idx).padStart(12, '0')}`,
        userId: i.userId,
        kind: i.kind,
        payload: {},
        groupId: null,
        sourceId: null,
        createdAt: new Date(FIXED_NOW),
        readAt: null,
      })),
  );
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('processEventReminderJob', () => {
  it('publie event:reminder avec userIds = members - RSVP(no)', async () => {
    getEventByIdMock.mockResolvedValue(
      makeEvent({
        rsvps: [
          { userId: 'user-no', value: 'no' },
          { userId: 'user-yes', value: 'yes' },
        ],
      }),
    );
    listMembersMock.mockResolvedValue([
      makeMember('user-yes'),
      makeMember('user-no'),
      makeMember('user-maybe'),
      makeMember('user-noresp'),
    ]);

    await processEventReminderJob(makeJob('evt-1', 'h1'));

    expect(publishNexusEventMock).toHaveBeenCalled();
    const reminderCalls = publishNexusEventMock.mock.calls
      .map((c) => c[0])
      .filter((c) => c.type === 'event:reminder');
    expect(reminderCalls).toHaveLength(1);
    const event = reminderCalls[0]!;
    expect(event.groupId).toBe('group-1');
    expect(event.payload.eventId).toBe('evt-1');
    expect(event.payload.tier).toBe('h1');
    // user-yes, user-maybe, user-noresp inclus ; user-no exclu
    expect(new Set(event.payload.userIds)).toEqual(
      new Set(['user-yes', 'user-maybe', 'user-noresp']),
    );
  });

  it('skip (no-op) quand l’event est introuvable', async () => {
    getEventByIdMock.mockResolvedValue(null);
    await processEventReminderJob(makeJob('evt-deleted', 'h24'));
    expect(listMembersMock).not.toHaveBeenCalled();
    expect(publishNexusEventMock).not.toHaveBeenCalled();
  });

  it('skip quand startsAt est dans le passé au-delà de la tolérance (5 min)', async () => {
    getEventByIdMock.mockResolvedValue(
      makeEvent({ startsAt: new Date(FIXED_NOW - 10 * 60 * 1000) }), // -10 min
    );
    await processEventReminderJob(makeJob('evt-1', 'h1'));
    expect(listMembersMock).not.toHaveBeenCalled();
    expect(publishNexusEventMock).not.toHaveBeenCalled();
  });

  it("tire encore quand startsAt est juste passé dans la tolérance (-2 min)", async () => {
    getEventByIdMock.mockResolvedValue(
      makeEvent({ startsAt: new Date(FIXED_NOW - 2 * 60 * 1000) }),
    );
    listMembersMock.mockResolvedValue([makeMember('user-a')]);

    await processEventReminderJob(makeJob('evt-1', 'h1'));

    expect(publishNexusEventMock).toHaveBeenCalled();
  });

  it("skip quand l'audience filtree est vide (tous RSVP=no)", async () => {
    getEventByIdMock.mockResolvedValue(
      makeEvent({
        rsvps: [
          { userId: 'user-a', value: 'no' },
          { userId: 'user-b', value: 'no' },
        ],
      }),
    );
    listMembersMock.mockResolvedValue([makeMember('user-a'), makeMember('user-b')]);

    await processEventReminderJob(makeJob('evt-1', 'h1'));

    expect(publishNexusEventMock).not.toHaveBeenCalled();
  });

  it('skip quand le groupe est vide', async () => {
    getEventByIdMock.mockResolvedValue(makeEvent());
    listMembersMock.mockResolvedValue([]);
    await processEventReminderJob(makeJob('evt-1', 'h1'));
    expect(publishNexusEventMock).not.toHaveBeenCalled();
  });

  it('insère 1 notif event_reminder par destinataire (sauf RSVP=no)', async () => {
    getEventByIdMock.mockResolvedValue(
      makeEvent({
        rsvps: [{ userId: 'user-no', value: 'no' }],
      }),
    );
    listMembersMock.mockResolvedValue([
      makeMember('user-yes'),
      makeMember('user-no'),
      makeMember('user-other'),
    ]);

    await processEventReminderJob(makeJob('evt-1', 'h1'));

    expect(insertNotificationsBulkMock).toHaveBeenCalledTimes(1);
    const inputs = insertNotificationsBulkMock.mock.calls[0]![0] as {
      userId: string;
      kind: string;
      groupId: string | null;
      sourceId: string | null;
      payload: Record<string, unknown>;
    }[];
    expect(new Set(inputs.map((i) => i.userId))).toEqual(
      new Set(['user-yes', 'user-other']),
    );
    for (const input of inputs) {
      expect(input.kind).toBe('event_reminder');
      expect(input.groupId).toBe('group-1');
      expect(input.sourceId).toBe('evt-1');
      expect(input.payload).toMatchObject({
        eventId: 'evt-1',
        eventTitle: 'Apéro',
        tier: 'h1',
      });
    }
  });

  it('publie 1 notification:created par notif insérée', async () => {
    getEventByIdMock.mockResolvedValue(makeEvent());
    listMembersMock.mockResolvedValue([
      makeMember('user-a'),
      makeMember('user-b'),
    ]);

    await processEventReminderJob(makeJob('evt-1', 'h24'));

    // 1 publish event:reminder + 2 publish notification:created
    expect(publishNexusEventMock).toHaveBeenCalledTimes(3);
    const calls = publishNexusEventMock.mock.calls.map((c) => c[0]);
    const reminders = calls.filter((c) => c.type === 'event:reminder');
    const notifs = calls.filter((c) => c.type === 'notification:created');
    expect(reminders).toHaveLength(1);
    expect(notifs).toHaveLength(2);
    for (const n of notifs) {
      expect(n.groupId).toBe('group-1');
      expect(n.payload.kind).toBe('event_reminder');
      expect(['user-a', 'user-b']).toContain(n.payload.userId);
    }
  });

  it('si insertNotificationsBulk échoue, le reminder WS est quand même publié (best-effort)', async () => {
    getEventByIdMock.mockResolvedValue(makeEvent());
    listMembersMock.mockResolvedValue([makeMember('user-a')]);
    insertNotificationsBulkMock.mockRejectedValueOnce(new Error('db down'));

    await processEventReminderJob(makeJob('evt-1', 'h1'));

    // Le reminder WS a bien été publié AVANT que l'insert ne soit tenté.
    const calls = publishNexusEventMock.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.type === 'event:reminder')).toBe(true);
    // Pas de notification:created publié quand l'insert a foiré.
    expect(calls.some((c) => c.type === 'notification:created')).toBe(false);
  });
});
