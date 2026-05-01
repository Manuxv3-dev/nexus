import { describe, expect, it } from 'vitest';

import { WsEventSchema } from './ws-protocol.js';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_GROUP = '00000000-0000-4000-8000-000000000010';
const UUID_SESSION = '00000000-0000-4000-8000-000000000020';

describe('WsEventSchema', () => {
  it('valide un presence:update conforme', () => {
    const event = {
      type: 'presence:update',
      payload: {
        userId: UUID_A,
        status: 'online',
      },
      timestamp: Date.now(),
    };
    expect(WsEventSchema.parse(event)).toEqual(event);
  });

  it('refuse un type inconnu', () => {
    expect(() =>
      WsEventSchema.parse({
        type: 'nope',
        payload: {},
        timestamp: 0,
      }),
    ).toThrow();
  });

  it('refuse un statut de présence invalide', () => {
    expect(() =>
      WsEventSchema.parse({
        type: 'presence:update',
        payload: { userId: UUID_A, status: 'maybe' },
        timestamp: 0,
      }),
    ).toThrow();
  });

  // ---- J3c — events messaging ----------------------------------------------

  describe('message:new', () => {
    it('valide un event conforme', () => {
      const event = {
        type: 'message:new',
        groupId: UUID_GROUP,
        sessionId: UUID_SESSION,
        providerType: 'discord',
        channelExternalId: 'ch-42',
        timestamp: Date.now(),
        payload: {
          message: {
            externalId: 'm-1',
            channelExternalId: 'ch-42',
            authorExternalId: 'u-1',
            authorDisplayName: 'Manu',
            authorAvatarUrl: null,
            content: 'hello',
            replyToExternalId: null,
            attachments: [],
            reactions: [],
            isEdited: false,
            isDeleted: false,
            externalCreatedAt: '2026-05-01T12:00:00.000Z',
            externalEditedAt: null,
          },
        },
      };
      expect(WsEventSchema.parse(event)).toEqual(event);
    });

    it('refuse sans groupId', () => {
      expect(() =>
        WsEventSchema.parse({
          type: 'message:new',
          sessionId: UUID_SESSION,
          providerType: 'discord',
          channelExternalId: 'ch-42',
          timestamp: 0,
          payload: {
            message: {
              externalId: 'm-1',
              channelExternalId: 'ch-42',
              authorExternalId: 'u-1',
              authorDisplayName: 'Manu',
              authorAvatarUrl: null,
              content: 'hello',
              replyToExternalId: null,
              attachments: [],
              reactions: [],
              isEdited: false,
              isDeleted: false,
              externalCreatedAt: '2026-05-01T12:00:00.000Z',
              externalEditedAt: null,
            },
          },
        }),
      ).toThrow();
    });

    it('refuse providerType invalide', () => {
      const base = {
        type: 'message:new',
        groupId: UUID_GROUP,
        sessionId: UUID_SESSION,
        providerType: 'slack',
        channelExternalId: 'ch-42',
        timestamp: 0,
        payload: { message: {} },
      };
      expect(() => WsEventSchema.parse(base)).toThrow();
    });
  });

  describe('message:delete', () => {
    it('valide un event conforme avec juste l\'externalMessageId', () => {
      const event = {
        type: 'message:delete',
        groupId: UUID_GROUP,
        sessionId: UUID_SESSION,
        providerType: 'discord',
        channelExternalId: 'ch-42',
        timestamp: Date.now(),
        payload: { externalMessageId: 'm-1' },
      };
      expect(WsEventSchema.parse(event)).toEqual(event);
    });
  });

  describe('message:reaction', () => {
    it('valide un event conforme', () => {
      const event = {
        type: 'message:reaction',
        groupId: UUID_GROUP,
        sessionId: UUID_SESSION,
        providerType: 'discord',
        channelExternalId: 'ch-42',
        timestamp: Date.now(),
        payload: {
          externalMessageId: 'm-1',
          emoji: '👍',
          byExternalUserId: 'u-1',
          added: true,
        },
      };
      expect(WsEventSchema.parse(event)).toEqual(event);
    });
  });

  describe('history:synced', () => {
    it('valide un event conforme', () => {
      const event = {
        type: 'history:synced',
        groupId: UUID_GROUP,
        sessionId: UUID_SESSION,
        providerType: 'discord',
        channelExternalId: 'ch-42',
        timestamp: Date.now(),
        payload: { count: 100 },
      };
      expect(WsEventSchema.parse(event)).toEqual(event);
    });
  });
});
