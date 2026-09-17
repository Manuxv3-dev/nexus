/**
 * Scheduling des rappels d'events (cf. ADR-020, J5b #42).
 *
 * Orchestre les jobs BullMQ `event-reminders` depuis les mutations REST
 * (POST / PATCH / DELETE sur `/api/v1/events`).
 *
 * Convention `jobId` : `event-reminder:{eventId}:{tier}` — déterministe pour
 * permettre :
 *  - la déduplication automatique (BullMQ refuse 2 jobs avec le même jobId)
 *  - le re-schedule propre via `queue.remove(jobId) + queue.add()`
 *  - la suppression ciblée à la suppression d'event
 *
 * Décisions actées (cf. ADR-020) :
 *  - 2 paliers fixes : T-24h (`h24`) et T-1h (`h1`)
 *  - Si `delay <= 0` à l'enqueue, on skip ce tier (pas de job dans le passé)
 *  - L'audience (filtrage RSVP=`no`) est calculée **côté worker** au moment
 *    du run, pas ici, pour rester fraîche aux derniers RSVP entre la
 *    création de l'event et le déclenchement du rappel.
 */
import type { EventReminderTier } from '@nexus/shared';

import { logger } from '../../core/logger.js';
import {
  getEventRemindersQueue,
  RedisTimeoutError,
  withRedisTimeout,
  type EventReminderJobData,
} from '../../workers/queues.js';

/**
 * Offsets en millisecondes par tier. Ordre stable pour faciliter les tests.
 */
const TIER_OFFSETS_MS: Record<EventReminderTier, number> = {
  h24: 24 * 60 * 60 * 1000,
  h1: 60 * 60 * 1000,
};

const TIERS: readonly EventReminderTier[] = ['h24', 'h1'] as const;

/** jobId déterministe — partagé entre scheduler et worker. */
export function reminderJobId(eventId: string, tier: EventReminderTier): string {
  return `event-reminder:${eventId}:${tier}`;
}

export interface SchedulableEvent {
  id: string;
  startsAt: Date;
}

/**
 * Programme les rappels pour un event. Idempotent grâce au jobId déterministe.
 *
 * Pour chaque tier (les deux tiers tournent en **parallèle**, cf. plus bas
 * pourquoi) :
 *  - calcule `delay = startsAt - now() - tierOffset`
 *  - si `delay <= 0` → skip (l'instant du rappel est déjà passé)
 *  - sinon `queue.add({ eventId, tier }, { jobId, delay })`, l'attente bornée
 *    par `withRedisTimeout` (cf. plus bas)
 *
 * Best-effort : un échec d'enqueue ne fait PAS échouer la mutation HTTP.
 * On log et on continue. Si Redis est down, l'event est créé/modifié
 * normalement, juste les rappels ne partiront pas.
 *
 * L'attente est bornée par `withRedisTimeout` (cf. `workers/queues.ts`) : sur
 * la connexion producteur d'`getEventRemindersQueue()`, `queue.add` ne
 * rejette jamais quand Redis est injoignable (ioredis met la commande en
 * file "offline" au lieu d'échouer) — sans le timeout, `POST /events` (et la
 * mise à jour de rappel) resterait pendu tant que Redis n'est pas revenu.
 *
 * Les tiers sont traités via `Promise.all` plutôt qu'une boucle séquentielle
 * (revue de #118) : chaque tier est déjà isolé par son propre try/catch, un
 * échec de l'un n'affecte pas l'autre — les traiter en série coûterait
 * jusqu'à `timeoutMs` **par tier** (2 × le timeout dans le pire cas) sans
 * bénéfice, alors qu'en parallèle le plafond reste `timeoutMs` au total.
 */
export async function scheduleEventReminders(event: SchedulableEvent): Promise<void> {
  const queue = getEventRemindersQueue();
  const now = Date.now();
  const startsAtMs = event.startsAt.getTime();

  await Promise.all(
    TIERS.map(async (tier) => {
      const delay = startsAtMs - now - TIER_OFFSETS_MS[tier];
      const jobId = reminderJobId(event.id, tier);

      if (delay <= 0) {
        logger.debug(
          { eventId: event.id, tier, delay },
          '[event-reminders] tier skipped (delay <= 0)',
        );
        return;
      }

      try {
        const data: EventReminderJobData = { eventId: event.id, tier };
        await withRedisTimeout(() => queue.add('event-reminder', data, { jobId, delay }));
        logger.debug({ eventId: event.id, tier, delay }, '[event-reminders] tier scheduled');
      } catch (err) {
        logger.warn({ err, eventId: event.id, tier }, '[event-reminders] failed to schedule tier');
      }
    }),
  );
}

/**
 * Annule tous les rappels programmés pour un event. À appeler depuis la
 * route DELETE event.
 *
 * Best-effort : un échec de suppression ne fait PAS échouer la mutation
 * HTTP. Le worker re-vérifie de toute façon l'existence de l'event au
 * moment du run, donc un job fantôme se solde par un no-op.
 *
 * `queue.remove` a la même exposition que `queue.add` (cf.
 * `scheduleEventReminders` et `workers/queues.ts`) : sur la connexion
 * producteur, il ne rejette jamais quand Redis est injoignable et pend
 * indéfiniment — d'où le même `withRedisTimeout` ici (revue de #118 :
 * `DELETE /events` et `rescheduleEventReminders`, PATCH, en dépendent).
 * `RedisTimeoutError` distingue ce cas (loggé en `warn`, Redis est down) du
 * cas normal où le job n'existe déjà plus (loggé en `debug`, no-op attendu).
 * Les deux tiers tournent en parallèle, même raisonnement que côté schedule.
 */
export async function cancelEventReminders(eventId: string): Promise<void> {
  const queue = getEventRemindersQueue();
  await Promise.all(
    TIERS.map(async (tier) => {
      const jobId = reminderJobId(eventId, tier);
      try {
        await withRedisTimeout(() => queue.remove(jobId));
      } catch (err) {
        if (err instanceof RedisTimeoutError) {
          logger.warn(
            { err, eventId, tier },
            '[event-reminders] failed to cancel tier (redis timeout)',
          );
        } else {
          logger.debug(
            { err, eventId, tier },
            '[event-reminders] cancel: job not found or already executed',
          );
        }
      }
    }),
  );
}

/**
 * Re-programme tous les rappels d'un event (ex. après un changement de
 * `startsAt`). Sucre syntaxique pour `cancel + schedule`.
 *
 * Note : grâce au jobId déterministe, on pourrait juste re-call
 * `scheduleEventReminders` (BullMQ refuserait silencieusement les jobs
 * existants), mais on perdrait le re-calcul du `delay`. Le pattern
 * cancel-then-schedule est explicite et garanti.
 */
export async function rescheduleEventReminders(event: SchedulableEvent): Promise<void> {
  await cancelEventReminders(event.id);
  await scheduleEventReminders(event);
}
