/**
 * Mapping "kind de notification → pane de navigation applicative".
 *
 * Avant cette extraction, la traduction d'un `NotificationKind` vers le pane
 * in-app à ouvrir vivait de façon ad-hoc et incomplète : un ternaire inline
 * dans `AppShell.tsx` (côté @nexus/web), propre au callback `onNavigate` de
 * `NotificationsBell`, qui omettait `todo_completed` (fallback silencieux
 * vers aucune navigation) et n'était pas réutilisable côté @nexus/backend.
 *
 * Centralisée ici pour être importable à la fois par @nexus/backend (MAN-143
 * Phase 2 — enrichissement du payload push) et @nexus/web (deep-link in-app
 * et depuis un clic sur notif push), en remplacement de la logique inline.
 */
import type { NotificationKind } from './ws-protocol.js';

export type NotificationNavPane = 'event' | 'poll' | 'expense' | 'todo' | 'home';

const KIND_TO_PANE: Record<NotificationKind, NotificationNavPane> = {
  event_reminder: 'event',
  event_rsvp_requested: 'event',
  event_rsvp_received: 'event',
  expense_added: 'expense',
  todo_assigned: 'todo',
  todo_completed: 'todo',
};

/**
 * Traduit un kind de notification vers le pane de navigation in-app à ouvrir
 * lors d'un clic (notif in-app ou push). `KIND_TO_PANE` est exhaustif sur
 * `NotificationKind`, mais le fallback `'home'` reste nécessaire en défense :
 * un payload push arrivant hors process (service worker, kind ajouté au
 * schéma sans mise à jour de ce module) n'est pas garanti par le typage.
 */
export function notificationKindToPane(kind: NotificationKind): NotificationNavPane {
  return KIND_TO_PANE[kind] ?? 'home';
}
