/**
 * Worker `discord-bridge` (cf. ADR-009, plan J3).
 *
 * Process séparé qui :
 *  1. Acquiert le lock distribué `lock:bridge:discord` (anti-doublon multi-replica)
 *  2. Démarre le client `discord.js` global (un bot = un process)
 *  3. Au `ready`, recheck la santé de toutes les sessions Discord en DB
 *  4. Écoute les events Gateway (MessageCreate/Update/Delete/ReactionAdd)
 *     → mappe en BridgeEvent → publish sur `bridge:event:discord`
 *  5. Écoute `bridge:control:discord` pour les commandes API (session:added, etc.)
 *  6. Graceful shutdown sur SIGTERM (release lock + close client + close redis)
 *
 * Démarrage en dev :  `pnpm dev:worker:discord`
 * Démarrage en prod : `pnpm start:worker:discord` (après build)
 */

import '../bootstrap-env.js';

import {
  Events,
  type DMChannel,
  type GuildBasedChannel,
  type Guild,
  type Message,
  type NonThreadGuildBasedChannel,
  type PartialMessage,
} from 'discord.js';

import { logger } from '../core/logger.js';
import { serveRpc } from '../integrations/core/bridge-rpc.js';
import { publishBridgeEvent, subscribeControl } from '../integrations/core/event-bus.js';
import { AppError } from '../core/errors.js';
import { createProvider } from '../integrations/core/bridge-registry.js';
import type { ProviderType } from '@nexus/shared';
import {
  findSession,
  findSessionByExternal,
  listAllSessions,
  updateSessionStatus,
} from '../integrations/core/session-store.js';
import {
  getDiscordClient,
  startDiscordClient,
  stopDiscordClient,
} from '../integrations/discord/client.js';
import { mapDiscordChannel, mapDiscordMessage } from '../integrations/discord/mapper.js';
// Import side-effect : auto-register du DiscordProvider dans le bridge-registry
import '../integrations/discord/index.js';
import { acquireLock, type BridgeLock } from './lock.js';

const PROVIDER: ProviderType = 'discord';

let bridgeLock: BridgeLock | undefined;

async function main(): Promise<void> {
  logger.info({ worker: 'discord-bridge' }, 'starting');

  // 1. Lock distribué — un seul worker discord-bridge par cluster
  bridgeLock = await acquireLock('lock:bridge:discord');
  logger.info({ worker: 'discord-bridge' }, 'lock acquired');

  // 2. Démarre le client discord.js (login + ready)
  const client = await startDiscordClient();
  logger.info({ worker: 'discord-bridge', botId: client.user?.id }, 'client ready');

  // 3. Recheck santé de toutes les sessions Discord
  await reconcileSessions();

  // 4. Listeners gateway events
  registerGatewayListeners();

  // 5. Listener commandes de contrôle (API → worker)
  await subscribeControl(PROVIDER, async (cmd) => {
    if (cmd.kind === 'session:added') {
      const session = await findSession(cmd.sessionId);
      if (!session || session.providerType !== 'discord') return;

      const guild = client.guilds.cache.get(session.externalId);
      if (guild) {
        await updateSessionStatus(session.id, {
          kind: 'connected',
          since: new Date().toISOString(),
        });
        // Seed des channels du guild — sans ça, la table messaging_channels
        // reste vide pour cette session jusqu'à ce qu'un nouveau channel
        // soit créé côté Discord.
        await seedChannelsForGuild(session.id, guild);
        logger.info(
          { sessionId: session.id, guildId: session.externalId, guildName: guild.name },
          'session activated',
        );
      } else {
        await updateSessionStatus(session.id, {
          kind: 'error',
          error: 'bot_not_in_guild',
          retryAt: null,
        });
        logger.warn(
          { sessionId: session.id, guildId: session.externalId },
          'session.added but bot not in guild',
        );
      }
    } else if (cmd.kind === 'session:removed') {
      // Le bot reste dans le guild — l'admin Discord doit le retirer
      // manuellement. Côté Nexus on a déjà supprimé la session DB.
      logger.info({ sessionId: cmd.sessionId }, 'session removed (cleanup-only)');
    }
  });

  // 6. Serveur RPC : permet au backend HTTP de demander fetchHistory et
  //    sendMessage au worker (qui détient le client Discord).
  await serveRpc(PROVIDER, {
    fetchHistory: async (args) => {
      const session = await findSession(args.sessionId);
      if (!session || session.providerType !== 'discord') {
        throw new AppError('RESOURCE_NOT_FOUND');
      }
      const provider = createProvider(session.providerType, session);
      const result = await provider.fetchHistory({
        channelExternalId: args.channelExternalId,
        ...(args.cursor ? { cursor: args.cursor } : {}),
        limit: args.limit,
      });
      return {
        messages: result.messages,
        nextCursor: result.nextCursor,
      };
    },
    sendMessage: async (args) => {
      const session = await findSession(args.sessionId);
      if (!session || session.providerType !== 'discord') {
        throw new AppError('RESOURCE_NOT_FOUND');
      }
      const provider = createProvider(session.providerType, session);
      if (!provider.capabilities.sendMessage) {
        throw new AppError('VALIDATION_ERROR', { reason: 'send_not_supported' });
      }
      const result = await provider.sendMessage({
        channelExternalId: args.channelExternalId,
        content: args.content,
        ...(args.replyToExternalId ? { replyToExternalId: args.replyToExternalId } : {}),
      });
      return {
        externalMessageId: result.externalMessageId,
        sentAt: result.sentAt,
      };
    },
  });
  logger.info({ worker: 'discord-bridge' }, 'rpc server ready');

  logger.info({ worker: 'discord-bridge' }, 'fully started');
}

async function reconcileSessions(): Promise<void> {
  const client = getDiscordClient();
  const sessions = await listAllSessions(PROVIDER);
  for (const s of sessions) {
    const guild = client.guilds.cache.get(s.externalId);
    if (guild) {
      await updateSessionStatus(s.id, {
        kind: 'connected',
        since: client.readyAt!.toISOString(),
      });
      // Seed initial des channels du guild — sans ce passage, la table
      // `messaging_channels` ne se peuple que quand un nouveau channel est
      // créé côté Discord (event ChannelCreate). Pour les channels déjà
      // existants au moment du rattachement, c'est ce seed qui les fait
      // remonter dans la liste côté API HTTP.
      await seedChannelsForGuild(s.id, guild);
    } else {
      await updateSessionStatus(s.id, {
        kind: 'error',
        error: 'bot_not_in_guild',
        retryAt: null,
      });
    }
  }
  logger.info({ count: sessions.length }, 'sessions reconciled');
}

/**
 * Parcourt tous les channels d'un guild et publie un `channel:upsert` pour
 * chaque channel texte supporté. Idempotent (le bridge-relay côté HTTP fait
 * un upsert DB). Appelé au boot et à chaque `session:added`.
 */
async function seedChannelsForGuild(sessionId: string, guild: Guild): Promise<void> {
  let count = 0;
  try {
    // `guild.channels.cache` est peuplé après le ready pour les guilds
    // de petite/moyenne taille ; pour les gros guilds on fetch en sécurité.
    const channels =
      guild.channels.cache.size > 0 ? guild.channels.cache : await guild.channels.fetch();
    for (const ch of channels.values()) {
      if (!ch) continue;
      await publishChannelUpsertFromDiscord(sessionId, ch);
      count += 1;
    }
  } catch (err) {
    logger.error({ err, sessionId, guildId: guild.id }, 'failed to seed channels for guild');
    return;
  }
  logger.info({ sessionId, guildId: guild.id, count }, 'channels seeded');
}

/**
 * Helper : map + publish un channel Discord vers `bridge:event:discord`.
 * Renvoie `false` si le channel n'est pas supporté (voice, thread, forum).
 */
async function publishChannelUpsertFromDiscord(
  sessionId: string,
  ch: NonThreadGuildBasedChannel | GuildBasedChannel | DMChannel,
): Promise<boolean> {
  const mapped = mapDiscordChannel(
    ch as GuildBasedChannel & { isTextBased(): boolean },
  );
  if (!mapped) return false;
  await publishBridgeEvent({
    kind: 'channel:upsert',
    sessionId,
    providerType: PROVIDER,
    timestamp: Date.now(),
    externalId: mapped.externalId,
    name: mapped.name,
    channelType: mapped.channelType,
  });
  return true;
}

function registerGatewayListeners(): void {
  const client = getDiscordClient();

  client.on(Events.MessageCreate, (msg) => {
    handleMessageCreate(msg).catch((err: unknown) => {
      logger.error({ err, messageId: msg.id }, 'failed to handle MessageCreate');
    });
  });

  client.on(Events.MessageUpdate, (_oldMsg, newMsg) => {
    handleMessageUpdate(newMsg).catch((err: unknown) => {
      logger.error({ err, messageId: newMsg.id }, 'failed to handle MessageUpdate');
    });
  });

  client.on(Events.MessageDelete, (msg) => {
    handleMessageDelete(msg).catch((err: unknown) => {
      logger.error({ err, messageId: msg.id }, 'failed to handle MessageDelete');
    });
  });

  // GuildDelete : le bot a été retiré du serveur
  client.on(Events.GuildDelete, (guild) => {
    handleGuildDelete(guild.id).catch((err: unknown) => {
      logger.error({ err, guildId: guild.id }, 'failed to handle GuildDelete');
    });
  });

  // GuildCreate : le bot vient d'etre ajoute a un nouveau serveur.
  client.on(Events.GuildCreate, (guild) => {
    handleGuildCreate(guild).catch((err: unknown) => {
      logger.error({ err, guildId: guild.id }, 'failed to handle GuildCreate');
    });
  });

  // ChannelCreate / ChannelUpdate : alimente messaging_channels en temps reel.
  client.on(Events.ChannelCreate, (ch) => {
    handleChannelUpsert(ch).catch((err: unknown) => {
      logger.error({ err, channelId: ch.id }, 'failed to handle ChannelCreate');
    });
  });
  client.on(Events.ChannelUpdate, (_oldCh, newCh) => {
    handleChannelUpsert(newCh).catch((err: unknown) => {
      logger.error({ err, channelId: newCh.id }, 'failed to handle ChannelUpdate');
    });
  });
  // ChannelDelete : V1 -> on laisse le record en DB (cf. backlog J5).
}

async function handleGuildCreate(guild: Guild): Promise<void> {
  const session = await findSessionByExternal(PROVIDER, guild.id);
  if (!session) return;
  await updateSessionStatus(session.id, {
    kind: 'connected',
    since: new Date().toISOString(),
  });
  await seedChannelsForGuild(session.id, guild);
}

async function handleChannelUpsert(
  ch: NonThreadGuildBasedChannel | GuildBasedChannel | DMChannel,
): Promise<void> {
  const guildId = 'guildId' in ch ? ch.guildId : null;
  if (!guildId) return;
  const session = await findSessionByExternal(PROVIDER, guildId);
  if (!session) return;
  await publishChannelUpsertFromDiscord(session.id, ch);
}

async function handleMessageCreate(msg: Message): Promise<void> {
  if (msg.author.bot && msg.author.id === getDiscordClient().user?.id) {
    return;
  }
  const session = await findGuildSession(msg.guildId);
  if (!session) return;

  const mapped = mapDiscordMessage(msg);
  await publishBridgeEvent({
    kind: 'message:new',
    sessionId: session.id,
    providerType: PROVIDER,
    timestamp: Date.now(),
    message: mapped,
  });
}

async function handleMessageUpdate(msg: Message | PartialMessage): Promise<void> {
  if (msg.partial) {
    try {
      msg = await msg.fetch();
    } catch {
      return;
    }
  }
  const guildId = msg.guildId;
  if (!guildId) return;
  const session = await findGuildSession(guildId);
  if (!session) return;


  const mapped = mapDiscordMessage(msg as Message);
  await publishBridgeEvent({
    kind: 'message:edit',
    sessionId: session.id,
    providerType: PROVIDER,
    timestamp: Date.now(),
    message: mapped,
  });
}

async function handleMessageDelete(msg: Message | PartialMessage): Promise<void> {
  const guildId = msg.guildId;
  if (!guildId) return;
  const session = await findGuildSession(guildId);
  if (!session) return;

  await publishBridgeEvent({
    kind: 'message:delete',
    sessionId: session.id,
    providerType: PROVIDER,
    timestamp: Date.now(),
    channelExternalId: msg.channelId,
    externalMessageId: msg.id,
  });
}

async function handleGuildDelete(guildId: string): Promise<void> {
  const session = await findSessionByExternal(PROVIDER, guildId);
  if (!session) return;
  await updateSessionStatus(session.id, {
    kind: 'error',
    error: 'bot_kicked',
    retryAt: null,
  });
  logger.warn({ sessionId: session.id, guildId }, 'bot removed from guild');
}

async function findGuildSession(guildId: string | null) {
  if (!guildId) return undefined;
  return findSessionByExternal(PROVIDER, guildId);
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ worker: 'discord-bridge', signal }, 'shutting down');
  try {
    await stopDiscordClient();
  } catch (err) {
    logger.error({ err }, 'failed to stop discord client');
  }
  if (bridgeLock) {
    try {
      await bridgeLock.release();
    } catch (err) {
      logger.error({ err }, 'failed to release lock');
    }
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  logger.fatal({ err }, 'discord-bridge worker failed to start');
  process.exit(1);
});
