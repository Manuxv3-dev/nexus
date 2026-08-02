/**
 * Hook qui écoute les events WS `event:reminder` et expose le dernier
 * rappel destiné à l'utilisateur courant.
 *
 * Le worker `event-reminders` (cf. ADR-020) émet un `event:reminder` avec
 * une liste `userIds` calculée côté backend (members du group sauf
 * RSVP=`no`). Côté front, on filtre sur le `userId` courant pour décider
 * d'afficher la toast — les autres clients du même group reçoivent l'event
 * mais le filtrent localement.
 *
 * La toast se clear automatiquement après `AUTO_DISMISS_MS`.
 */
import type { EventReminderTier } from '@nexus/shared';
import { useEffect, useRef, useState } from 'react';

import { useWs } from './ws';

const AUTO_DISMISS_MS = 8000;

export interface EventReminderToast {
  eventId: string;
  groupId: string;
  tier: EventReminderTier;
}

export function useEventReminderToast(
  currentUserId: string | null,
  enabled: boolean,
): { toast: EventReminderToast | null; dismiss: () => void } {
  const [toast, setToast] = useState<EventReminderToast | null>(null);
  const dismissTimerRef = useRef<number | undefined>(undefined);

  useWs({
    enabled,
    onEvent: (event) => {
      if (event.type !== 'event:reminder') return;
      if (!currentUserId) return;
      if (!event.payload.userIds.includes(currentUserId)) return;
      setToast({
        eventId: event.payload.eventId,
        groupId: event.groupId,
        tier: event.payload.tier,
      });
      if (dismissTimerRef.current !== undefined) {
        window.clearTimeout(dismissTimerRef.current);
      }
      dismissTimerRef.current = window.setTimeout(() => {
        setToast(null);
        dismissTimerRef.current = undefined;
      }, AUTO_DISMISS_MS);
    },
  });

  // Cleanup du timer au unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== undefined) {
        window.clearTimeout(dismissTimerRef.current);
      }
    };
  }, []);

  return {
    toast,
    dismiss: () => {
      if (dismissTimerRef.current !== undefined) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = undefined;
      }
      setToast(null);
    },
  };
}

/** Texte humain du palier de rappel. */
export function reminderTierLabel(tier: EventReminderTier): string {
  return tier === 'h24' ? 'dans 24 heures' : 'dans 1 heure';
}
