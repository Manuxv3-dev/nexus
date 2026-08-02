/**
 * Bus Redis pour les events killer features (cf. ADR-003 + J5b #37).
 *
 * Les events sont déjà au format WsEvent (cf. @nexus/shared/ws-protocol),
 * pas de transformation nécessaire — c'est le backend HTTP lui-même qui
 * publie (suite à une mutation REST) et qui subscribe (pour broadcast aux
 * sockets WS via `nexus-relay.ts`).
 *
 * Pourquoi un bus Redis pour des events qui partent du même process ?
 *  1. Multi-instance backend HTTP (scale horizontal) : chaque instance
 *     subscribe et broadcast aux sockets locaux. Sans Redis, un user
 *     connecté à l'instance B ne reçoit pas les events publiés par A.
 *  2. Cohérence avec le pattern bridge-relay (cf. ws/bridge-relay.ts).
 *  3. Future séparation worker BullMQ (rappels Events J5b #42) : le worker
 *     publish, le backend relay.
 *
 * Topic : `nexus:event` (un seul, pas de sharding par groupe — payload léger).
 */
import { WsEventSchema, type WsEvent } from '@nexus/shared';
import Redis from 'ioredis';

import { loadEnv } from '../core/env.js';
import { logger } from '../core/logger.js';

const TOPIC = 'nexus:event';

let publisher: Redis | undefined;
let subscriber: Redis | undefined;

function getPublisher(): Redis {
  if (publisher) return publisher;
  publisher = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  return publisher;
}

/**
 * Publie un event Nexus (killer features) sur Redis. Best-effort : si
 * Redis est down on log et on continue (la mutation REST a déjà réussi).
 */
export async function publishNexusEvent(event: WsEvent): Promise<void> {
  try {
    await getPublisher().publish(TOPIC, JSON.stringify(event));
  } catch (err) {
    logger.warn(
      { err, type: event.type },
      '[nexus-bus] publish failed, WS clients may miss this event',
    );
  }
}

/**
 * S'abonne au topic `nexus:event`. Le handler reçoit le `WsEvent` déjà
 * validé Zod. Validation defensive : si un payload corrompu arrive, on
 * log et on ignore.
 *
 * Idempotent : le 2e appel renvoie sans re-souscrire.
 */
export async function subscribeNexusEvents(
  handler: (event: WsEvent) => void | Promise<void>,
): Promise<void> {
  if (subscriber) return;
  subscriber = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  await subscriber.subscribe(TOPIC);
  subscriber.on('message', (_channel, message) => {
    try {
      const parsed = WsEventSchema.parse(JSON.parse(message));
      void handler(parsed);
    } catch (err) {
      logger.warn({ err }, '[nexus-bus] invalid event received, ignored');
    }
  });
}

/**
 * Reset interne pour les tests.
 */
export async function closeNexusBus(): Promise<void> {
  if (publisher) {
    publisher.disconnect();
    publisher = undefined;
  }
  if (subscriber) {
    await subscriber.unsubscribe().catch(() => undefined);
    subscriber.disconnect();
    subscriber = undefined;
  }
}
