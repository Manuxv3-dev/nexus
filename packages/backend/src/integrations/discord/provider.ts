import { ChannelType, type GuildBasedChannel, type Message, type TextChannel } from 'discord.js';

import { AppError } from '../../core/errors.js';
import type { MessagingProviderSession } from '../../db/schema/index.js';

import { getDiscordClient } from './client.js';
import { mapDiscordChannel, mapDiscordMessage } from './mapper.js';

import type {
  FetchHistoryInput,
  FetchHistoryResult,
  MessagingProvider,
  ProviderCapabilities,
  ProviderChannel,
  ProviderMessage,
  ProviderStatus,
  SendMessageInput,
  SendMessageResult,
} from '@nexus/shared';

/**
 * Implémentation `MessagingProvider` pour Discord.
 *
 * Référence un client `discord.js` partagé (singleton géré par
 * `client.ts`, démarré par le worker `discord-bridge.ts`).
 *
 * Une instance de `DiscordProvider` est créée via le `bridge-registry`
 * pour une session donnée — elle scope ses opérations sur le guild
 * `session.externalId`. Toutes les opérations passent par le client
 * partagé.
 */
export class DiscordProvider implements MessagingProvider {
  readonly type = 'discord' as const;

  readonly capabilities: ProviderCapabilities = {
    sendMessage: true,
    editMessage: true,
    deleteMessage: true,
    reactions: true,
    attachments: true,
    voice: false, // V2+
    threads: false, // V2+
    presence: true,
    typingIndicator: true,
  };

  constructor(private readonly session: MessagingProviderSession) {
    if (session.providerType !== 'discord') {
      throw new AppError('INTERNAL_ERROR', { reason: 'discord_provider_wrong_session_type' });
    }
  }

  async connect(): Promise<void> {
    // No-op : le client est démarré par le worker singleton, pas par le
    // provider. Cette méthode existe pour respect du contrat.
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    // No-op : on ne déconnecte pas le client (partagé entre toutes les
    // sessions). Pour réellement supprimer la session, le bot doit être
    // retiré du serveur Discord — action manuelle de l'admin du serveur.
    return Promise.resolve();
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const channel = await this.fetchTextChannel(input.channelExternalId);
    const sent = (await channel.send({
      content: input.content,
      ...(input.replyToExternalId
        ? { reply: { messageReference: input.replyToExternalId } }
        : {}),
    })) as Message;

    return {
      externalMessageId: sent.id,
      sentAt: sent.createdAt.toISOString(),
    };
  }

  async fetchHistory(input: FetchHistoryInput): Promise<FetchHistoryResult> {
    const channel = await this.fetchTextChannel(input.channelExternalId);
    const limit = input.limit ?? 50;
    const fetched = await channel.messages.fetch({
      limit,
      ...(input.cursor ? { before: input.cursor } : {}),
    });

    const messages: ProviderMessage[] = [];
    let oldestId: string | null = null;

    // discord.js retourne une Collection ordonnée du plus récent au plus ancien
    for (const msg of fetched.values()) {
      messages.push(mapDiscordMessage(msg));
      oldestId = msg.id;
    }

    return {
      messages,
      nextCursor: fetched.size === limit ? oldestId : null,
    };
  }

  async listChannels(): Promise<ProviderChannel[]> {
    const client = getDiscordClient();
    const guild = await client.guilds.fetch(this.session.externalId).catch(() => null);
    if (!guild) {
      throw new AppError('RESOURCE_NOT_FOUND', { reason: 'guild_not_accessible' });
    }
    const channels = await guild.channels.fetch();
    const result: ProviderChannel[] = [];
    for (const ch of channels.values()) {
      if (!ch) continue;
      const mapped = mapDiscordChannel(ch as GuildBasedChannel & { isTextBased(): boolean });
      if (mapped) result.push(mapped);
    }
    return result;
  }

  getStatus(): ProviderStatus {
    const client = getDiscordClient();
    if (client.isReady()) {
      return { kind: 'connected', since: client.readyAt!.toISOString() };
    }
    return { kind: 'connecting' };
  }

  // ----- Helpers privés ------------------------------------------------------

  private async fetchTextChannel(channelId: string): Promise<TextChannel> {
    const client = getDiscordClient();
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch) {
      throw new AppError('RESOURCE_NOT_FOUND', { reason: 'channel_not_found' });
    }
    if (
      ch.type !== ChannelType.GuildText &&
      ch.type !== ChannelType.GuildAnnouncement
    ) {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'channel_type_unsupported',
        type: ch.type,
      });
    }
    return ch as TextChannel;
  }
}
