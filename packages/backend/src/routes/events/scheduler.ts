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
 * Pour chaque tier :
 *  - calcule `delay = startsAt - now() - tierOffset`
 *  - si `delay <= 0` → skip (l'instant du rappel est déjà passé)
 *  - sinon `queue.add({ eventId, tier }, { jobId, delay })`
 *
 * Best-effort : un échec d'enqueue ne fait PAS échouer la mutation HTTP.
 * On log et on continue. Si Redis est down, l'event est créé/modifié
 * normalement, juste les rappels ne partiront pas.
 */
export async function scheduleEventReminders(event: SchedulableEvent): Promise<void> {
  const queue = getEventRemindersQueue();
  const now = Date.now();
  const startsAtMs = event.startsAt.getTime();

  for (const tier of TIERS) {
    const delay = startsAtMs - now - TIER_OFFSETS_MS[tier];
    const jobId = reminderJobId(event.id, tier);

    if (delay <= 0) {
      logger.debug(
        { eventId: event.id, tier, delay },
        '[event-reminders] tier skipped (delay <= 0)',
      );
      continue;
    }

    try {
      const data: EventReminderJobData = { eventId: event.id, tier };
      await queue.add('event-reminder', data, { jobId, delay });
      logger.debug(
        { eventId: event.id, tier, delay },
        '[event-reminders] tier scheduled',
      );
    } catch (err) {
      logger.warn(
        { err, eventId: event.id, tier },
        '[event-reminders] failed to schedule tier',
      );
    }
  }
}

/**
 * Annule tous les rappels programmés pour un event. À appeler depuis la
 * route DELETE event.
 *
 * Best-effort : un échec de suppression ne fait PAS échouer la mutation
 * HTTP. Le worker re-vérifie de toute façon l'existence de l'event au
 * moment du run, donc un job fantôme se solde par un no-op.
 */
export async function cancelEventReminders(eventId: string): Promise<void> {
  const queue = getEventRemindersQueue();
  for (const tier of TIERS) {
    const jobId = reminderJobId(eventId, tier);
    try {
      await queue.remove(jobId);
    } catch (err) {
      logger.debug(
        { err, eventId, tier },
        '[event-reminders] cancel: job not found or already executed',
      );
    }
  }
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
