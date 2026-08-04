import { describe, expect, it } from 'vitest';

import { notificationKindToPane } from './notifications.js';
import type { NotificationKind } from './ws-protocol.js';

describe('notificationKindToPane', () => {
  it.each<[NotificationKind, 'event' | 'poll' | 'expense' | 'todo' | 'home']>([
    ['event_reminder', 'event'],
    ['event_rsvp_requested', 'event'],
    ['event_rsvp_received', 'event'],
    ['expense_added', 'expense'],
    ['todo_assigned', 'todo'],
    ['todo_completed', 'todo'],
  ])('mappe %s vers le pane %s', (kind, expectedPane) => {
    expect(notificationKindToPane(kind)).toBe(expectedPane);
  });

  it("retombe sur 'home' pour un kind inconnu (défensif, hors union stricte)", () => {
    expect(notificationKindToPane('some_future_kind' as unknown as NotificationKind)).toBe('home');
  });
});
