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

vi.mock('../routes/events/repo.js', () => ({
  getEventById: (...args: unknown[]) => getEventByIdMock(...args),
}));

vi.mock('../routes/groups/service.js', () => ({
  listMembers: (...args: unknown[]) => listMembersMock(...args),
}));

vi.mock('../ws/nexus-event-bus.js', () => ({
  publishNexusEvent: (...args: unknown[]) => publishNexusEventMock(...args),
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
    channelId: null,
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

    expect(publishNexusEventMock).toHaveBeenCalledTimes(1);
    const event = publishNexusEventMock.mock.calls[0]![0];
    expect(event.type).toBe('event:reminder');
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

    expect(publishNexusEventMock).toHaveBeenCalledTimes(1);
  });

  it("skip quand l'audience filtrée est vide (tous RSVP=no)", async () => {
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
});
