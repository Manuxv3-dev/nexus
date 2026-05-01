import type {
  Attachment as ProviderAttachment,
  ProviderChannel,
  ProviderMessage,
  Reaction,
} from '@nexus/shared';

/**
 * Mapper Discord → Nexus.
 *
 * Convertit les types `discord.js` en types normalisés `@nexus/shared`.
 * Volontairement isolé en fonctions pures, sans I/O, pour tests unitaires
 * faciles avec des fixtures.
 *
 * Les types d'entrée sont définis ici comme interfaces minimales (juste
 * les champs qu'on consomme), pour ne pas dépendre des types lourds de
 * `discord.js` côté tests. À l'usage runtime (worker), on passe des objets
 * `Message<true>` / `Channel` / `MessageReaction` qui sont compatibles
 * structurellement.
 */

// ----- Types d'entrée minimaux -----------------------------------------------

export interface DiscordUserLike {
  id: string;
  username: string;
  globalName: string | null;
  bot: boolean;
  displayAvatarURL: () => string;
}

export interface DiscordAttachmentLike {
  id: string;
  url: string;
  contentType: string | null;
  size: number;
  name: string;
  width: number | null;
  height: number | null;
}

export interface DiscordReactionEmojiLike {
  name: string | null;
  id: string | null;
}

export interface DiscordReactionLike {
  emoji: DiscordReactionEmojiLike;
  count: number;
  me: boolean;
}

export interface DiscordMessageLike {
  id: string;
  channelId: string;
  author: DiscordUserLike;
  content: string;
  reference: { messageId?: string | null | undefined } | null;
  attachments: { values: () => Iterable<DiscordAttachmentLike> } | Map<string, DiscordAttachmentLike>;
  reactions: { cache: Map<string, DiscordReactionLike> } | null;
  editedAt: Date | null;
  createdAt: Date;
}

export interface DiscordTextChannelLike {
  id: string;
  name: string;
  type: number; // ChannelType enum value (discord.js)
  isTextBased: () => boolean;
}

// ----- Helpers ---------------------------------------------------------------

function toAttachment(a: DiscordAttachmentLike): ProviderAttachment {
  const att: ProviderAttachment = {
    url: a.url,
    type: a.contentType ?? 'application/octet-stream',
    size: a.size,
    name: a.name,
  };
  if (a.width !== null) att.width = a.width;
  if (a.height !== null) att.height = a.height;
  return att;
}

function emojiToString(emoji: DiscordReactionEmojiLike): string {
  // Discord : emoji peut être un unicode (`name` rempli, `id` null) ou un
  // custom emoji (`id` rempli). On les sérialise sous forme stable :
  //  - unicode : "👍"
  //  - custom  : ":name:id" (ce qu'on stocke côté Nexus pour l'affichage)
  if (emoji.id) {
    return `:${emoji.name ?? 'custom'}:${emoji.id}`;
  }
  return emoji.name ?? '?';
}

function getAttachmentsArray(
  src: DiscordMessageLike['attachments'],
): DiscordAttachmentLike[] {
  if (src instanceof Map) {
    return Array.from(src.values());
  }
  return Array.from(src.values());
}

// ----- Mapping principal ----------------------------------------------------

/**
 * Convertit un message Discord en `ProviderMessage` Nexus.
 */
export function mapDiscordMessage(msg: DiscordMessageLike): ProviderMessage {
  const reactions: Reaction[] = [];
  if (msg.reactions) {
    for (const r of msg.reactions.cache.values()) {
      reactions.push({
        emoji: emojiToString(r.emoji),
        count: r.count,
        byMe: r.me,
      });
    }
  }

  return {
    externalId: msg.id,
    channelExternalId: msg.channelId,
    authorExternalId: msg.author.id,
    authorDisplayName: msg.author.globalName ?? msg.author.username,
    authorAvatarUrl: msg.author.displayAvatarURL(),
    content: msg.content,
    replyToExternalId: msg.reference?.messageId ?? null,  // normalize undefined → null
    attachments: getAttachmentsArray(msg.attachments).map(toAttachment),
    reactions,
    isEdited: msg.editedAt !== null,
    isDeleted: false, // un MessageDelete event produit un BridgeMessageDeleteEvent séparé
    externalCreatedAt: msg.createdAt.toISOString(),
    externalEditedAt: msg.editedAt?.toISOString() ?? null,
  };
}

// ----- Channel type mapping -------------------------------------------------

/**
 * Discord ChannelType (numérique en discord.js v14) :
 *   0  = GuildText
 *   1  = DM
 *   2  = GuildVoice (ignored, non textuel)
 *   3  = GroupDM
 *   5  = GuildAnnouncement
 *   10 = AnnouncementThread
 *   11 = PublicThread
 *   12 = PrivateThread
 *   15 = GuildForum
 *   16 = GuildMedia
 *
 * Pour J3b on traite : GuildText → 'text', DM → 'dm', GroupDM → 'group_dm'.
 * Les threads/forums sont V2 (cf. capabilities.threads = false).
 */
export function mapDiscordChannelType(type: number): 'text' | 'dm' | 'group_dm' | null {
  switch (type) {
    case 0:
    case 5: // announcement = treated as text
      return 'text';
    case 1:
      return 'dm';
    case 3:
      return 'group_dm';
    default:
      return null; // type non supporté → ignoré côté Nexus
  }
}

/**
 * Convertit un channel Discord en `ProviderChannel`. Renvoie null si le
 * type n'est pas supporté (voice, thread, forum, etc.).
 */
export function mapDiscordChannel(ch: DiscordTextChannelLike): ProviderChannel | null {
  const channelType = mapDiscordChannelType(ch.type);
  if (channelType === null) return null;
  if (!ch.isTextBased()) return null;
  return {
    externalId: ch.id,
    name: ch.name,
    channelType,
    isArchived: false,
  };
}
