import { registerProvider } from '../core/bridge-registry.js';

import { DiscordProvider } from './provider.js';

/**
 * Enregistrement du DiscordProvider dans le bridge-registry.
 *
 * Importer ce module a un side-effect : à la première import, le provider
 * Discord devient disponible via `createProvider('discord', session)`.
 *
 * Pour éviter les double-registers en cas d'import multiple (tests, etc.),
 * on protège avec un flag local.
 */

let registered = false;

export function registerDiscordProvider(): void {
  if (registered) return;
  registerProvider('discord', (session) => new DiscordProvider(session));
  registered = true;
}

// Auto-register à l'import (convention monorepo : les providers s'enregistrent
// au load). Si tu veux contrôler explicitement, importe et appelle
// `registerDiscordProvider()` plutôt qu'importer ce module en effet de bord.
registerDiscordProvider();

export { DiscordProvider } from './provider.js';
export {
  createDiscordClient,
  getDiscordClient,
  setDiscordClientForTests,
  startDiscordClient,
  stopDiscordClient,
} from './client.js';
export {
  mapDiscordChannel,
  mapDiscordChannelType,
  mapDiscordMessage,
} from './mapper.js';
