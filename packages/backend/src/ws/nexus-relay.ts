/**
 * Relay des events Nexus killer features → WebSocket clients (J5b #37).
 *
 * Pendant pour `bridge-relay.ts`, mais pour les events Nexus internes
 * (events / polls / expenses / todos). Cf. ADR-003.
 *
 * Pipeline :
 *  1. Subscribe `nexus:event` Redis pubsub via `subscribeNexusEvents`
 *  2. Pour chaque WsEvent reçu : résoudre ses destinataires
 *     (`resolveRecipients`), puis broadcast à leurs sockets connectées.
 *
 * Anti-leak : seuls les membres du groupe scope reçoivent l'event — sauf les
 * deux exceptions documentées sur `resolveRecipients`, qui livrent MOINS
 * largement, pas plus.
 */
import type { WsEvent } from '@nexus/shared';

import { logger } from '../core/logger.js';

import { connectionStore } from './connection-store.js';
import { getGroupMembers } from './membership-cache.js';
import { subscribeNexusEvents } from './nexus-event-bus.js';

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

/**
 * À qui cet event doit-il être livré ?
 *
 * Le cas général est « les membres courants du groupe ». Deux events en
 * sortent, parce que le groupe n'est pas le bon critère pour eux (cf. ticket
 * 28514439) :
 *
 * **`notification:created`** est adressée à UNE personne — son `payload.userId`.
 * La router par groupe la livrait à tous les membres, qui apprenaient au
 * passage qu'un tiers avait reçu une notification et de quel `kind`, pour un
 * effet nul côté client (chacun n'invalide que sa propre cloche). Pire : le
 * schéma autorise un `groupId` null, et ces events-là tombaient dans la
 * branche « sans groupId, ignoré » — ils n'étaient livrés à personne.
 *
 * **`member:removed`** concerne la personne retirée, qui vient précisément
 * d'être supprimée de `group_members` (et `removeMember` invalide le cache
 * dans la foulée, cf. MAN-17). Elle est donc absente de la liste au moment du
 * broadcast : sans cet ajout explicite, un utilisateur éjecté n'apprend jamais
 * son éjection en direct, et son app continue d'afficher le groupe.
 *
 * L'un et l'autre restreignent ou ciblent la livraison ; aucun ne l'élargit à
 * quelqu'un qui n'est pas déjà concerné par l'event.
 */
export async function resolveRecipients(event: WsEvent): Promise<string[]> {
  if (event.type === 'notification:created') {
    return [event.payload.userId];
  }

  // Tous les events killer features ont un `groupId` (cf. KillerEventBaseSchema
  // dans ws-protocol.ts). Les events historiques (presence, message:*) ont
  // aussi un groupId mais transitent par bridge-relay, pas par ici.
  const groupId = 'groupId' in event && typeof event.groupId === 'string' ? event.groupId : null;
  if (!groupId) {
    logger.warn({ type: event.type }, '[nexus-relay] event without groupId, ignored');
    return [];
  }

  const memberIds = await getGroupMembers(groupId);

  if (event.type === 'member:removed' && !memberIds.includes(event.payload.userId)) {
    return [...memberIds, event.payload.userId];
  }
  return memberIds;
}

async function relay(event: WsEvent): Promise<void> {
  try {
    const recipients = await resolveRecipients(event);
    if (recipients.length === 0) return;

    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const userId of recipients) {
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
      logger.debug(
        { type: event.type, recipients: recipients.length, delivered },
        'nexus event relayed',
      );
    }
  } catch (err) {
    logger.error({ err, type: event.type }, 'failed to relay nexus event');
  }
}
