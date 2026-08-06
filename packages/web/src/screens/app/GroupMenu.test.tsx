/**
 * GroupMenu — tests du menu kebab du groupe (MAN-111 Phase 2 : habillage &
 * entrée du shell/nav).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Group } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

import { GroupMenu } from './GroupMenu';

// Le menu navigue vers `/groups/$groupId/members` (MAN-180 Phase 1 Task 4) —
// pas de RouterProvider réel monté ici, donc on mocke `useNavigate` comme
// dans AppShell.test.tsx / MobileShell.test.tsx.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// `ConfirmGroupActionDialog` passe depuis MAN-201 par `GlassDialogShell`, qui
// appelle `useIsMobile` donc `window.matchMedia` — le stub par défaut
// (branche desktop) vit dans `test/setup.ts`, pas ici.
//
// `useDeleteGroup`/`useLeaveGroup` sont mockés (spies) UNIQUEMENT pour
// pouvoir affirmer qu'ils ne sont PAS appelés (Escape/Annuler) — pas mockés
// avant cette revue (MAN-201), donc "sans appeler les mutations" ne prouvait
// jusqu'ici rien de plus qu'un clic qui ne jette pas.
const { deleteMutateAsyncMock, leaveMutateAsyncMock } = vi.hoisted(() => ({
  deleteMutateAsyncMock: vi.fn(),
  leaveMutateAsyncMock: vi.fn(),
}));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useDeleteGroup: () => ({ mutateAsync: deleteMutateAsyncMock, isPending: false }),
    useLeaveGroup: () => ({ mutateAsync: leaveMutateAsyncMock, isPending: false }),
  };
});

const TEST_GROUP: Group = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'La Bande du 11e',
  createdBy: '11111111-1111-1111-1111-111111111111',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

function renderMenu(group: Group = TEST_GROUP) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupMenu group={group} />
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

  // MAN-201 : `ConfirmGroupActionDialog` passe par le shell partagé
  // `GlassDialogShell` — pas de couverture dédiée avant cette migration
  // (aucun test n'ouvrait ce dialog), on ajoute donc un minimum plutôt que
  // d'en éditer un existant.
  describe('ConfirmGroupActionDialog (glass dialog shell)', () => {
    afterEach(() => {
      deleteMutateAsyncMock.mockReset();
      leaveMutateAsyncMock.mockReset();
    });

    async function openDeleteConfirm() {
      const user = userEvent.setup();
      renderMenu();
      await user.click(screen.getByRole('button', { name: 'Options du groupe' }));
      await user.click(screen.getByRole('menuitem', { name: 'Supprimer le groupe' }));
      return user;
    }

    it('expose role="dialog", aria-modal, et un nom accessible dérivé du titre', async () => {
      await openDeleteConfirm();

      const dialog = screen.getByRole('dialog', { name: 'Supprimer "La Bande du 11e" ?' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('Escape ferme le dialog sans appeler les mutations', async () => {
      const user = await openDeleteConfirm();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(deleteMutateAsyncMock).not.toHaveBeenCalled();
      expect(leaveMutateAsyncMock).not.toHaveBeenCalled();
    });

    // MAN-201 review M1 : ce cas était TOUJOURS cassé avant le correctif —
    // `setOpen(false)` (ferme le menu) et `setConfirmKind(...)` (ouvre ce
    // dialog) sont batchés dans le même handler (`GroupMenu.tsx`), donc le
    // `menuitem` cliqué est déjà retiré du DOM avant même que
    // `GlassDialogShell` ait pu capturer `document.activeElement` — il vaut
    // déjà `document.body` à ce moment-là. `returnFocusRef` (le kebab
    // `buttonRef`) est le seul mécanisme qui permette de restaurer le focus
    // ici ; sans lui, cette assertion échoue quel que soit le chemin de
    // fermeture (Escape, Annuler, ou confirmation).
    it('rend le focus au bouton kebab après la fermeture (Annuler) — cassé avant le repli returnFocusRef', async () => {
      const user = await openDeleteConfirm();
      const dialog = screen.getByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Options du groupe' })).toHaveFocus();
    });

    it('le bouton Annuler ferme le dialog', async () => {
      const user = await openDeleteConfirm();
      const dialog = screen.getByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('quitter un groupe non-owner affiche le titre "Quitter"', async () => {
      const user = userEvent.setup();
      renderMenu({ ...TEST_GROUP, role: 'member' });
      await user.click(screen.getByRole('button', { name: 'Options du groupe' }));
      await user.click(screen.getByRole('menuitem', { name: 'Quitter le groupe' }));

      expect(
        screen.getByRole('dialog', { name: 'Quitter "La Bande du 11e" ?' }),
      ).toBeInTheDocument();
    });
  });
});
