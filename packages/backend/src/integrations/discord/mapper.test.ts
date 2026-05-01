import { describe, expect, it } from 'vitest';

import {
  type DiscordMessageLike,
  type DiscordTextChannelLike,
  mapDiscordChannel,
  mapDiscordChannelType,
  mapDiscordMessage,
} from './mapper.js';

/**
 * Tests unitaires du mapper Discord.
 *
 * Stratégie : fixtures minimalistes qui ne dépendent pas de discord.js
 * (les types `*Like` sont structurels, on construit des objets à la main).
 */

function makeUser(over: Partial<DiscordMessageLike['author']> = {}): DiscordMessageLike['author'] {
  return {
    id: 'user-123',
    username: 'manu',
    globalName: 'Manu',
    bot: false,
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/user-123/abc.png',
    ...over,
  };
}

function makeMessage(over: Partial<DiscordMessageLike> = {}): DiscordMessageLike {
  return {
    id: 'msg-1',
    channelId: 'ch-42',
    author: makeUser(),
    content: 'hello',
    reference: null,
    attachments: new Map(),
    reactions: null,
    editedAt: null,
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...over,
  };
}

describe('mapDiscordMessage', () => {
  it('mappe un message texte simple', () => {
    const out = mapDiscordMessage(makeMessage());
    expect(out).toEqual({
      externalId: 'msg-1',
      channelExternalId: 'ch-42',
      authorExternalId: 'user-123',
      authorDisplayName: 'Manu',
      authorAvatarUrl: 'https://cdn.discordapp.com/avatars/user-123/abc.png',
      content: 'hello',
      replyToExternalId: null,
      attachments: [],
      reactions: [],
      isEdited: false,
      isDeleted: false,
      externalCreatedAt: '2026-05-01T12:00:00.000Z',
      externalEditedAt: null,
    });
  });

  it('utilise username si globalName est null', () => {
    const out = mapDiscordMessage(makeMessage({ author: makeUser({ globalName: null }) }));
    expect(out.authorDisplayName).toBe('manu');
  });

  it('mappe un reply (message.reference.messageId)', () => {
    const out = mapDiscordMessage(makeMessage({ reference: { messageId: 'msg-original' } }));
    expect(out.replyToExternalId).toBe('msg-original');
  });

  it('mappe un message édité', () => {
    const editedAt = new Date('2026-05-01T12:05:00Z');
    const out = mapDiscordMessage(makeMessage({ editedAt }));
    expect(out.isEdited).toBe(true);
    expect(out.externalEditedAt).toBe('2026-05-01T12:05:00.000Z');
  });

  it('mappe les attachments avec contentType', () => {
    const attachments = new Map([
      [
        'a-1',
        {
          id: 'a-1',
          url: 'https://cdn/a.png',
          contentType: 'image/png',
          size: 1024,
          name: 'a.png',
          width: 100,
          height: 200,
        },
      ],
    ]);
    const out = mapDiscordMessage(makeMessage({ attachments }));
    expect(out.attachments).toEqual([
      {
        url: 'https://cdn/a.png',
        type: 'image/png',
        size: 1024,
        name: 'a.png',
        width: 100,
        height: 200,
      },
    ]);
  });

  it('utilise application/octet-stream si contentType est null', () => {
    const attachments = new Map([
      [
        'a-1',
        {
          id: 'a-1',
          url: 'https://cdn/file.bin',
          contentType: null,
          size: 50,
          name: 'file.bin',
          width: null,
          height: null,
        },
      ],
    ]);
    const out = mapDiscordMessage(makeMessage({ attachments }));
    expect(out.attachments[0]?.type).toBe('application/octet-stream');
  });

  it('mappe les reactions unicode et custom emoji', () => {
    const reactions = {
      cache: new Map([
        [
          'r-1',
          {
            emoji: { name: '👍', id: null },
            count: 3,
            me: true,
          },
        ],
        [
          'r-2',
          {
            emoji: { name: 'partyparrot', id: '987654' },
            count: 1,
            me: false,
          },
        ],
      ]),
    };
    const out = mapDiscordMessage(makeMessage({ reactions }));
    expect(out.reactions).toEqual([
      { emoji: '👍', count: 3, byMe: true },
      { emoji: ':partyparrot:987654', count: 1, byMe: false },
    ]);
  });
});

describe('mapDiscordChannelType', () => {
  it('GuildText (0) → text', () => {
    expect(mapDiscordChannelType(0)).toBe('text');
  });
  it('GuildAnnouncement (5) → text (traité comme un channel texte normal)', () => {
    expect(mapDiscordChannelType(5)).toBe('text');
  });
  it('DM (1) → dm', () => {
    expect(mapDiscordChannelType(1)).toBe('dm');
  });
  it('GroupDM (3) → group_dm', () => {
    expect(mapDiscordChannelType(3)).toBe('group_dm');
  });
  it('Voice (2) → null (non supporté)', () => {
    expect(mapDiscordChannelType(2)).toBeNull();
  });
  it('Threads (10, 11, 12) → null (V2)', () => {
    expect(mapDiscordChannelType(10)).toBeNull();
    expect(mapDiscordChannelType(11)).toBeNull();
    expect(mapDiscordChannelType(12)).toBeNull();
  });
  it('Forum (15) / Media (16) → null', () => {
    expect(mapDiscordChannelType(15)).toBeNull();
    expect(mapDiscordChannelType(16)).toBeNull();
  });
});

describe('mapDiscordChannel', () => {
  function makeChannel(over: Partial<DiscordTextChannelLike> = {}): DiscordTextChannelLike {
    return {
      id: 'ch-42',
      name: 'general',
      type: 0,
      isTextBased: () => true,
      ...over,
    };
  }

  it('mappe un GuildText channel', () => {
    expect(mapDiscordChannel(makeChannel())).toEqual({
      externalId: 'ch-42',
      name: 'general',
      channelType: 'text',
      isArchived: false,
    });
  });

  it('renvoie null pour un channel voice', () => {
    expect(mapDiscordChannel(makeChannel({ type: 2 }))).toBeNull();
  });

  it("renvoie null pour un channel non text-based malgré son type", () => {
    expect(mapDiscordChannel(makeChannel({ isTextBased: () => false }))).toBeNull();
  });
});
