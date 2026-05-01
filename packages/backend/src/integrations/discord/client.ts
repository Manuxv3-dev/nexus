import { Client, GatewayIntentBits } from 'discord.js';

import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';

/**
 * Singleton client `discord.js`.
 *
 * Le bot Discord = une seule connexion gateway pour TOUS les guilds Nexus
 * (cf. ADR-009 + plan J3). Le worker `discord-bridge.ts` instancie ce
 * client une fois au boot, et le `DiscordProvider` le réutilise pour
 * les opérations applicatives (sendMessage, fetchHistory, listChannels).
 *
 * Design :
 *  - `getDiscordClient()` retourne l'instance courante (throw si pas démarrée)
 *  - `startDiscordClient()` instancie + login (worker uniquement)
 *  - `stopDiscordClient()` clean shutdown
 *  - `setDiscordClientForTests()` permet l'injection en tests
 */

let client: Client | undefined;

export function getDiscordClient(): Client {
  if (!client) {
    throw new AppError('INTERNAL_ERROR', { reason: 'discord_client_not_started' });
  }
  return client;
}

/**
 * Crée le client avec les intents nécessaires pour Nexus :
 *  - Guilds : pour découvrir les serveurs où le bot est ajouté
 *  - GuildMessages : recevoir MessageCreate/Update/Delete
 *  - MessageContent : lire le `content` (privileged intent — à activer
 *    dans le portail Discord developer)
 *  - GuildMembers : connaître les membres pour l'affichage côté Nexus
 *    (privileged intent)
 *  - GuildMessageReactions : recevoir les ajouts/retraits de réactions
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
    ],
  });
}

/**
 * Instancie le client (s'il ne l'est pas déjà), login avec
 * `DISCORD_BOT_TOKEN`, et résout quand l'event `ClientReady` est émis.
 */
export async function startDiscordClient(): Promise<Client> {
  if (client) return client;

  const env = loadEnv();
  const token = process.env['DISCORD_BOT_TOKEN'];
  if (!token) {
    throw new AppError('INTERNAL_ERROR', { reason: 'DISCORD_BOT_TOKEN missing' });
  }

  const c = createDiscordClient();
  client = c;

  // Suppress unused warning — env may be used later for log level / etc.
  void env;

  await new Promise<void>((resolve, reject) => {
    c.once('ready', () => {
      resolve();
    });
    c.once('error', (err) => {
      reject(err);
    });
    c.login(token).catch(reject);
  });

  return c;
}

export async function stopDiscordClient(): Promise<void> {
  if (!client) return;
  await client.destroy();
  client = undefined;
}

/**
 * Injection pour tests. `null` reset le singleton.
 */
export function setDiscordClientForTests(c: Client | null): void {
  client = c ?? undefined;
}
