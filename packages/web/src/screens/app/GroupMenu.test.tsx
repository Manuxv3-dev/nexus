/**
 * GroupMenu — tests du menu kebab du groupe (MAN-111 Phase 2 : habillage &
 * entrée du shell/nav).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Group } from '@/lib/queries';

import { GroupMenu } from './GroupMenu';

// Le menu navigue vers `/groups/$groupId/members` (MAN-180 Phase 1 Task 4) —
// pas de RouterProvider réel monté ici, donc on mocke `useNavigate` comme
// dans AppShell.test.tsx / MobileShell.test.tsx.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const TEST_GROUP: Group = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'La Bande du 11e',
  createdBy: '11111111-1111-1111-1111-111111111111',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupMenu group={TEST_GROUP} />
    </QueryClientProvider>,
  );
}

describe('GroupMenu', () => {
  describe('profondeur visuelle (MAN-111 Task 2)', () => {
    it('le déclencheur du menu porte un token d’ombre, au même registre visuel que le reste du shell', () => {
      renderMenu();

      const trigger = screen.getByRole('button', { name: 'Options du groupe' });

      expect(trigger.style.boxShadow).not.toBe('');
      expect(trigger.style.boxShadow).toContain('var(--nx-shadow');
    });
  });

  describe('migration vers le composant Button partagé (MAN-111 Task 3)', () => {
    it('le déclencheur porte les classes de `Button` sans perdre son ombre inline', () => {
      renderMenu();

      const trigger = screen.getByRole('button', { name: 'Options du groupe' });
      const classes = trigger.className.split(/\s+/);

      // Classes issues de `buttonVariants` (cf. components/ui/Button.tsx).
      expect(classes).toEqual(
        expect.arrayContaining(['inline-flex', 'items-center', 'justify-center']),
      );
      expect(classes.some((c) => /^hover:shadow-(sm|md)$/.test(c))).toBe(true);
      // `cn`/tailwind-merge : le className local gagne sur `size="icon"`.
      expect(classes).toContain('h-7');
      expect(classes).not.toContain('h-10');
      // …et le `style` inline traverse `Button` : la profondeur Task 2 survit.
      expect(trigger.style.boxShadow).toContain('var(--nx-shadow');
    });

    it('reflète visuellement l’état ouvert, pas seulement via aria-expanded', async () => {
      const user = userEvent.setup();
      renderMenu();

      const trigger = screen.getByRole('button', { name: 'Options du groupe' });
      expect(trigger.className).not.toMatch(/\bbg-nx-elevated\b/);

      await user.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger.className).toMatch(/\bbg-nx-elevated\b/);
    });
  });

  describe('comportement du déclencheur (garde-fou de non-régression)', () => {
    it('ouvre le menu au clic, sans régression suite à l’ajout de la profondeur visuelle', async () => {
      const user = userEvent.setup();
      renderMenu();

      const trigger = screen.getByRole('button', { name: 'Options du groupe' });
      await user.click(trigger);

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
  });
});
