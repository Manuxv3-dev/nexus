/**
 * Relay des events Nexus killer features → WebSocket clients (J5b #37).
 *
 * Pendant pour `bridge-relay.ts`, mais pour les events Nexus internes
 * (events / polls / expenses / todos). Cf. ADR-003.
 *
 * Pipeline :
 *  1. Subscribe `nexus:event` Redis pubsub via `subscribeNexusEvents`
 *  2. Pour chaque WsEvent reçu :
 *     - Resolve `groupId` → liste des membres (via cache 5 min, partagé
 *       avec bridge-relay)
 *     - Broadcast aux sockets WS des membres connectés
 *
 * Anti-leak : seuls les membres du groupe scope reçoivent l'event.
 */
import { logger } from '../core/logger.js';

import { connectionStore } from './connection-store.js';
import { getGroupMembers } from './membership-cache.js';
import { subscribeNexusEvents } from './nexus-event-bus.js';

import type { WsEvent } from '@nexus/shared';

let started = false;

export async function startNexusRelay(): Promise<void> {
  if (started) {
    throw new Error('nexus-relay already started');
  }
  started = true;

  await subscribeNexusEvents((event) => {
    void relay(event);
  });

  logger.info({ component: 'nexus-relay' }, 'started');
}

/**
 * Reset interne pour tests.
 */
export function resetNexusRelay(): void {
  started = false;
}

async function relay(event: WsEvent): Promise<void> {
  // Tous les events killer features ont un `groupId` (cf. KillerEventBaseSchema
  // dans ws-protocol.ts). Les events historiques (presence, message:*) ont
  // aussi un groupId mais transitent par bridge-relay, pas par ici.
  const groupId = 'groupId' in event && typeof event.groupId === 'string' ? event.groupId : null;
  if (!groupId) {
    logger.warn({ type: event.type }, '[nexus-relay] event without groupId, ignored');
    return;
  }

  try {
    const memberIds = await getGroupMembers(groupId);
    if (memberIds.length === 0) return;

    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const userId of memberIds) {
      for (const conn of connectionStore.getByUser(userId)) {
        try {
          conn.socket.send(payload);
          delivered++;
        } catch {
          // socket fermé entre temps, ignoré
        }
      }
    }

    if (delivered > 0) {
      logger.debug({ type: event.type, groupId, delivered }, 'nexus event relayed');
    }
  } catch (err) {
    logger.error({ err, type: event.type, groupId }, 'failed to relay nexus event');
  }
}
