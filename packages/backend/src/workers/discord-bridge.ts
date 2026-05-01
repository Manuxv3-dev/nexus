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

import './bootstrap-env.js';

import { Events, type Message, type PartialMessage } from 'discord.js';

import { logger } from '../core/logger.js';
import { publishBridgeEvent, subscribeControl } from '../integrations/core/event-bus.js';
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
import { mapDiscordMessage } from '../integrations/discord/mapper.js';
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
}

async function handleMessageCreate(msg: Message): Promise<void> {
  if (msg.author.bot && msg.author.id === getDiscordClient().user?.id) {
    // Skip nos propres messages (échos)
    return;
  }
  const session = await findGuildSession(msg.guildId);
  if (!session) return; // message dans un guild non rattaché à Nexus

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
    // Discord envoie parfois des partial messages — fetch pour avoir le full
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

// ----- Graceful shutdown -----------------------------------------------------

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

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

main().catch((err: unknown) => {
  logger.fatal({ err }, 'discord-bridge worker failed to start');
  process.exit(1);
});
