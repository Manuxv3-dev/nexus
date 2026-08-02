/**
 * NotificationsBell — tests (MAN-111 Phase 2 : habillage & entrée du
 * shell/nav, Task 3 — migration du déclencheur vers le composant `Button`
 * partagé).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as QueriesModule from '@/lib/queries';

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useNotifications: () => ({
      data: {
        notifications: [],
        unreadCount: 3,
      },
      isLoading: false,
    }),
    useMarkNotificationRead: () => ({ mutate: vi.fn() }),
    useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
    useClearAllNotifications: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

import { NotificationsBell } from './NotificationsBell';

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationsBell />
    </QueryClientProvider>,
  );
}

describe('NotificationsBell', () => {
  describe('migration vers le composant Button partagé (MAN-111 Task 3)', () => {
    it('le déclencheur porte les classes du composant Button (CVA/Tailwind)', () => {
      renderBell();

      const trigger = screen.getByRole('button', { name: /Notifications/ });
      const classes = trigger.className.split(/\s+/);

      // Classes issues de `buttonVariants` (cf. components/ui/Button.tsx) —
      // pas une reconstruction manuelle des mêmes styles en inline.
      expect(classes).toContain('transition-all');
      expect(classes.some((c) => /^hover:shadow-(sm|md)$/.test(c))).toBe(true);
    });

    it('reflète visuellement l’état ouvert du panel, pas seulement via aria-expanded', async () => {
      const user = userEvent.setup();
      renderBell();

      const trigger = screen.getByRole('button', { name: /Notifications/ });
      expect(trigger.className).not.toMatch(/\bbg-nx-elevated\b/);

      await user.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger.className).toMatch(/\bbg-nx-elevated\b/);
    });

    it('préserve le badge unread et le comportement onClick (ouvre/ferme le panel)', async () => {
      const user = userEvent.setup();
      renderBell();

      const trigger = screen.getByRole('button', { name: /3 non lues/ });
      expect(trigger).toHaveTextContent('3');

      expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();

      await user.click(trigger);
      expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();

      await user.click(trigger);
      expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    });
  });
});
