import { AppError } from '../../core/errors.js';

import type { MessagingProviderSession } from '../../db/schema/index.js';
import type { MessagingProvider, ProviderType } from '@nexus/shared';

/**
 * Registry des implémentations de `MessagingProvider`.
 *
 * Chaque sous-module `integrations/<provider>/` s'auto-enregistre via
 * `registerProvider()` au moment du chargement (import side-effect).
 * Le backend HTTP appelle `createProvider()` pour obtenir une instance
 * scopée à une session donnée.
 *
 * Note : le worker Discord est singleton (un seul process pour tous les
 * guilds Nexus), donc l'instance retournée par `createProvider('discord', ...)`
 * peut partager un client `discord.js` global. C'est le sous-module
 * `integrations/discord/provider.ts` qui gère cette mécanique.
 */

export type ProviderConstructor = (session: MessagingProviderSession) => MessagingProvider;

const registry = new Map<ProviderType, ProviderConstructor>();

export function registerProvider(type: ProviderType, ctor: ProviderConstructor): void {
  if (registry.has(type)) {
    throw new AppError('INTERNAL_ERROR', { reason: 'provider_already_registered', type });
  }
  registry.set(type, ctor);
}

export function createProvider(
  type: ProviderType,
  session: MessagingProviderSession,
): MessagingProvider {
  const ctor = registry.get(type);
  if (!ctor) {
    throw new AppError('INTERNAL_ERROR', { reason: 'provider_not_registered', type });
  }
  return ctor(session);
}

export function isProviderRegistered(type: ProviderType): boolean {
  return registry.has(type);
}

/**
 * Reset du registry. Utilisé uniquement par les tests.
 */
export function resetRegistry(): void {
  registry.clear();
}
