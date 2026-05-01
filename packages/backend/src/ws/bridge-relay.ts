import { logger } from '../core/logger.js';
import { upsertMessagingChannel } from '../integrations/core/channel-store.js';
import { findSession } from '../integrations/core/session-store.js';
import { subscribeBridgeEvents } from '../integrations/core/event-bus.js';

import { connectionStore } from './connection-store.js';
import { getGroupMembers } from './membership-cache.js';

import type { BridgeEvent, WsEvent } from '@nexus/shared';

/**
 * Relay des events bridges → WebSocket Nexus (J3c).
 *
 * Au boot du backend HTTP :
 *  1. S'abonne à `bridge:event:*` via `subscribeBridgeEvents`
 *  2. Pour chaque BridgeEvent reçu :
 *     - Resolve `sessionId` → session DB → `groupId`
 *     - Resolve `groupId` → liste des membres (via cache 5 min)
 *     - Mappe BridgeEvent → WsEvent (typage discriminé)
 *     - Broadcast aux sockets WS des membres connectés
 *
 * Anti-leak : seuls les membres du groupe propriétaire de la session
 * reçoivent l'event. Un user externe au groupe ne voit jamais un
 * `message:new` même s'il est connecté en WS.
 */

let started = false;

export async function startBridgeRelay(): Promise<void> {
  if (started) {
    throw new Error('bridge-relay already started');
  }
  started = true;

  await subscribeBridgeEvents(async (event) => {
    try {
      await relayEvent(event);
    } catch (err) {
      logger.error({ err, event: event.kind, sessionId: event.sessionId }, 'failed to relay bridge event');
    }
  });

  logger.info({ component: 'bridge-relay' }, 'started');
}

/**
 * Reset interne pour tests.
 */
export function resetBridgeRelay(): void {
  started = false;
}

async function relayEvent(event: BridgeEvent): Promise<void> {
  const session = await findSession(event.sessionId);
  if (!session) {
    logger.warn({ sessionId: event.sessionId, kind: event.kind }, 'unknown sessionId in bridge event, skipping');
    return;
  }

  // Side-effect : persister les channels en DB pour que `GET /channels`
  // côté HTTP puisse les lister sans appeler le client provider (qui
  // n'existe que dans le process worker — cf. ADR-009).
  if (event.kind === 'channel:upsert') {
    try {
      await upsertMessagingChannel({
        sessionId: session.id,
        externalChannelId: event.externalId,
        name: event.name,
        channelType: event.channelType,
      });
    } catch (err) {
      logger.error(
        { err, sessionId: session.id, externalId: event.externalId },
        'failed to upsert messaging_channel',
      );
    }
  }

  const wsEvent = mapBridgeToWs(event, session.groupId);
  if (!wsEvent) {
    return; // event non-broadcasté (ex: status:update purement interne)
  }

  const memberIds = await getGroupMembers(session.groupId);
  if (memberIds.length === 0) return;

  const payload = JSON.stringify(wsEvent);
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
    logger.debug({ kind: wsEvent.type, groupId: session.groupId, delivered }, 'bridge event relayed');
  }
}

/**
 * Convertit un BridgeEvent en WsEvent typé. Renvoie `null` si l'event
 * ne doit pas être broadcasté tel quel (ex. status:update / channel:upsert
 * sont des events de plomberie qui n'ont pas encore d'équivalent WS).
 */
function mapBridgeToWs(event: BridgeEvent, groupId: string): WsEvent | null {
  switch (event.kind) {
    case 'message:new':
      return {
        type: 'message:new',
        groupId,
        sessionId: event.sessionId,
        providerType: event.providerType,
        channelExternalId: event.message.channelExternalId,
        timestamp: event.timestamp,
        payload: { message: event.message },
      };
    case 'message:edit':
      return {
        type: 'message:edit',
        groupId,
        sessionId: event.sessionId,
        providerType: event.providerType,
        channelExternalId: event.message.channelExternalId,
        timestamp: event.timestamp,
        payload: { message: event.message },
      };
    case 'message:delete':
      return {
        type: 'message:delete',
        groupId,
        sessionId: event.sessionId,
        providerType: event.providerType,
        channelExternalId: event.channelExternalId,
        timestamp: event.timestamp,
        payload: { externalMessageId: event.externalMessageId },
      };
    case 'message:reaction':
      return {
        type: 'message:reaction',
        groupId,
        sessionId: event.sessionId,
        providerType: event.providerType,
        channelExternalId: event.channelExternalId,
        timestamp: event.timestamp,
        payload: {
          externalMessageId: event.externalMessageId,
          emoji: event.emoji,
          byExternalUserId: event.byExternalUserId,
          added: event.added,
        },
      };
    case 'history:synced':
      return {
        type: 'history:synced',
        groupId,
        sessionId: event.sessionId,
        providerType: event.providerType,
        channelExternalId: event.channelExternalId,
        timestamp: event.timestamp,
        payload: { count: event.count },
      };
    case 'channel:upsert':
    case 'status:update':
      // Pas de broadcast WS direct pour V1 (events de plomberie internes).
      // Le `channel:upsert` a deja ete persiste en DB via upsertMessagingChannel
      // dans relayEvent() avant ce switch.
      return null;
  }
}
