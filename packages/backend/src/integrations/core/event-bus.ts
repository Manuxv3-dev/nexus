import Redis from 'ioredis';

import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';

import {
  type BridgeControl,
  type BridgeEvent,
  BridgeControlSchema,
  BridgeEventSchema,
  type ProviderType,
  controlTopic,
  eventTopic,
} from '@nexus/shared';

/**
 * Event bus Redis pub/sub (cf. ADR-009).
 *
 * Deux types de topics :
 *  - `bridge:event:<providerType>`  — events normalisés émis par les workers
 *    (worker → backend HTTP → WS clients). Un publisher ioredis dédié.
 *  - `bridge:control:<providerType>` — commandes envoyées par le backend
 *    HTTP au worker (ex: "tu as une nouvelle session, prends-la en compte").
 *    Un publisher ioredis dédié.
 *
 * Redis pub/sub demande des clients séparés pour publisher et subscriber
 * (limitation native : un client en mode subscriber ne peut plus exécuter
 * d'autres commandes).
 *
 * Ce module expose :
 *  - `publishBridgeEvent(event)`  — appelé par les workers
 *  - `subscribeBridgeEvents(handler)` — appelé par le backend HTTP au boot
 *  - `publishControl(providerType, cmd)` — appelé par les routes API
 *  - `subscribeControl(providerType, handler)` — appelé par les workers au boot
 *
 * Tous les payloads sont validés Zod en sortie de pub et en entrée de sub.
 */

let publisher: Redis | undefined;
let eventSubscriber: Redis | undefined;
const controlSubscribers = new Map<ProviderType, Redis>();

function getPublisher(): Redis {
  publisher ??= new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  return publisher;
}

// ----- Bridge events (worker → backend) --------------------------------------

export async function publishBridgeEvent(event: BridgeEvent): Promise<void> {
  // Valide la forme avant publication (defensive)
  const parsed = BridgeEventSchema.parse(event);
  const payload = JSON.stringify(parsed);
  const topic = eventTopic(parsed.providerType);
  await getPublisher().publish(topic, payload);
}

export type BridgeEventHandler = (event: BridgeEvent) => void | Promise<void>;

async function dispatchEvent(message: string, handler: BridgeEventHandler): Promise<void> {
  const raw = JSON.parse(message) as unknown;
  const parsed = BridgeEventSchema.parse(raw);
  await handler(parsed);
}

/**
 * Abonne un handler à TOUS les topics `bridge:event:*`.
 * Utilisé par le backend HTTP au boot. Throw si déjà abonné.
 */
export async function subscribeBridgeEvents(handler: BridgeEventHandler): Promise<void> {
  if (eventSubscriber) {
    throw new AppError('INTERNAL_ERROR', { reason: 'bridge_events_already_subscribed' });
  }
  const sub = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  await sub.psubscribe('bridge:event:*');
  sub.on('pmessage', (_pattern, _channel, message) => {
    dispatchEvent(message, handler).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[event-bus] failed to process bridge event', err);
    });
  });
  eventSubscriber = sub;
}

// ----- Control commands (backend → worker) ----------------------------------

export async function publishControl(
  providerType: ProviderType,
  cmd: BridgeControl,
): Promise<void> {
  const parsed = BridgeControlSchema.parse(cmd);
  const payload = JSON.stringify(parsed);
  const topic = controlTopic(providerType);
  await getPublisher().publish(topic, payload);
}

export type BridgeControlHandler = (cmd: BridgeControl) => void | Promise<void>;

async function dispatchControl(
  message: string,
  handler: BridgeControlHandler,
): Promise<void> {
  const raw = JSON.parse(message) as unknown;
  const parsed = BridgeControlSchema.parse(raw);
  await handler(parsed);
}

/**
 * Abonne un handler aux commandes de contrôle d'un provider donné.
 * Appelé par les workers au boot.
 */
export async function subscribeControl(
  providerType: ProviderType,
  handler: BridgeControlHandler,
): Promise<void> {
  if (controlSubscribers.has(providerType)) {
    throw new AppError('INTERNAL_ERROR', {
      reason: 'control_already_subscribed',
      providerType,
    });
  }
  const sub = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 3 });
  const topic = controlTopic(providerType);
  await sub.subscribe(topic);
  sub.on('message', (_channel, message) => {
    dispatchControl(message, handler).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[event-bus] failed to process control command', err);
    });
  });
  controlSubscribers.set(providerType, sub);
}

// ----- Cleanup --------------------------------------------------------------

/**
 * Ferme tous les clients Redis du module. À appeler au shutdown du backend
 * et des workers, ou en teardown de tests.
 */
export async function closeEventBus(): Promise<void> {
  const all: Promise<unknown>[] = [];
  if (publisher) {
    all.push(publisher.quit());
    publisher = undefined;
  }
  if (eventSubscriber) {
    all.push(eventSubscriber.quit());
    eventSubscriber = undefined;
  }
  for (const sub of controlSubscribers.values()) {
    all.push(sub.quit());
  }
  controlSubscribers.clear();
  await Promise.allSettled(all);
}
