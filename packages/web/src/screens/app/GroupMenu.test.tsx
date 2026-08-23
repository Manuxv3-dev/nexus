/**
 * GroupMenu — tests du menu kebab du groupe (MAN-111 Phase 2 : habillage &
 * entrée du shell/nav).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Group, InvitationDto } from '@/lib/queries';
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
const { deleteMutateAsyncMock, leaveMutateAsyncMock, createInvitationMutateAsyncMock } = vi.hoisted(
  () => ({
    deleteMutateAsyncMock: vi.fn(),
    leaveMutateAsyncMock: vi.fn(),
    createInvitationMutateAsyncMock: vi.fn(),
  }),
);

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useDeleteGroup: () => ({ mutateAsync: deleteMutateAsyncMock, isPending: false }),
    useLeaveGroup: () => ({ mutateAsync: leaveMutateAsyncMock, isPending: false }),
    // Mocké pour piloter l'état de `InviteDialog` (MAN-241) sans dépendre
    // d'un réseau réel en jsdom — jamais résolu dans les tests a11y ci-dessous
    // (état `loading`), qui n'ont pas besoin d'un lien d'invitation concret.
    useCreateInvitation: () => ({ mutateAsync: createInvitationMutateAsyncMock, isPending: false }),
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

const TEST_INVITATION: InvitationDto = {
  id: '33333333-3333-3333-3333-333333333333',
  groupId: TEST_GROUP.id,
  slug: 'abc123',
  role: 'member',
  maxUses: null,
  usedCount: 0,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  revokedAt: null,
  createdAt: new Date().toISOString(),
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

  // MAN-241 : `InviteDialog` migré vers `GlassDialogShell` — avant cette
  // migration, il n'y avait AUCUNE fermeture au clavier (pas de listener
  // Escape du tout), donc les deux premiers tests couvrent un gain net, pas
  // seulement une non-régression.
  describe('InviteDialog (glass dialog shell, MAN-241)', () => {
    afterEach(() => {
      createInvitationMutateAsyncMock.mockReset();
    });

    async function openInviteDialog() {
      const user = userEvent.setup();
      renderMenu();
      await user.click(screen.getByRole('button', { name: 'Options du groupe' }));
      await user.click(screen.getByRole('menuitem', { name: "Inviter quelqu'un" }));
      return user;
    }

    it('expose role="dialog", aria-modal, et un nom accessible dérivé du titre', async () => {
      await openInviteDialog();

      const dialog = screen.getByRole('dialog', {
        name: "Inviter quelqu'un dans « La Bande du 11e »",
      });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('Escape ferme le dialog — aucune fermeture clavier n’existait avant cette migration', async () => {
      const user = await openInviteDialog();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Même mécanisme que `ConfirmGroupActionDialog` (M1) : ouvrir ce dialog
    // referme le menu déroulant dans le même commit, donc le `menuitem`
    // cliqué sort du DOM avant que `GlassDialogShell` ait pu capturer
    // `document.activeElement` — sans `returnFocusRef`, cette assertion
    // échouerait quel que soit le chemin de fermeture.
    it('rend le focus au bouton kebab après la fermeture (Escape)', async () => {
      const user = await openInviteDialog();

      await user.keyboard('{Escape}');

      expect(screen.getByRole('button', { name: 'Options du groupe' })).toHaveFocus();
    });

    // Race pré-existante sur `main` (déjà atteignable via un clic sur
    // l'overlay pendant l'état `loading`), mais rendue trivialement
    // atteignable par cette migration : avant MAN-241, `InviteDialog` n'avait
    // AUCUNE fermeture clavier, donc `Escape` pendant le chargement ne
    // fermait rien. `startInvite()` (`GroupMenu.tsx`) ferme le menu ET lance
    // `createInvitation.mutateAsync(...)` dans le même handler ; si la
    // mutation aboutit APRÈS que l'utilisateur a fermé le dialog, l'ancien
    // code rappelait `setInviteState({ state: 'ready', ... })` sans savoir
    // que le dialog avait déjà été fermé entre-temps — `inviteState`
    // redevenait non-null et le dialog se rouvrait tout seul.
    it("ne se rouvre pas si la mutation d'invitation aboutit après une fermeture (Escape) pendant le chargement", async () => {
      let resolveInvite!: (invitation: InvitationDto) => void;
      const invitePromise = new Promise<InvitationDto>((resolve) => {
        resolveInvite = resolve;
      });
      createInvitationMutateAsyncMock.mockReturnValue(invitePromise);

      const user = await openInviteDialog();
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await act(async () => {
        resolveInvite(TEST_INVITATION);
        await invitePromise;
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
  // MAN-246 Phase 1 — deux libellés du menu affirmaient ce que le produit ne
  // fait pas : le texte de suppression promettait une déconnexion des
  // messageries (aucune session n'est liée à un groupe, cf. ADR-027), et la
  // copie de l'ID annonçait un succès sans jamais regarder si l'écriture
  // presse-papiers avait abouti.
  describe('libellés qui surpromettent (MAN-246 points 2 et 3)', () => {
    /**
     * À appeler APRÈS `userEvent.setup()` : user-event v14 installe son propre
     * stub `navigator.clipboard` au setup, qui écrase silencieusement un mock
     * posé avant — le spy n'était alors jamais appelé.
     */
    function mockClipboard(writeText: (text: string) => Promise<void>) {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function openMenu(group: Group = TEST_GROUP) {
      const user = userEvent.setup();
      renderMenu(group);
      await user.click(screen.getByRole('button', { name: 'Options du groupe' }));
      return user;
    }

    it('ne promet plus de déconnecter les messageries en supprimant le groupe', async () => {
      const user = await openMenu();

      await user.click(screen.getByRole('menuitem', { name: 'Supprimer le groupe' }));

      const dialog = screen.getByRole('dialog');
      // Vestiges pré-ADR-027 : il n'y a plus de bridge, et `deleteGroup` ne
      // touche aucune ligne de `messaging_provider_sessions`.
      expect(dialog).not.toHaveTextContent(/bridg/i);
      expect(dialog).not.toHaveTextContent(/déconnect/i);
      expect(dialog).not.toHaveTextContent(/Discord|WhatsApp|Messenger/i);
      // Ce qui est réellement supprimé reste annoncé.
      expect(dialog).toHaveTextContent(/irréversible/i);
      expect(dialog).toHaveTextContent(/événements/i);
      expect(dialog).toHaveTextContent(/sondages/i);
      expect(dialog).toHaveTextContent(/dépenses/i);
      expect(dialog).toHaveTextContent(/listes/i);
    });

    it('ne promet plus de conversations de groupe en quittant', async () => {
      const user = await openMenu({ ...TEST_GROUP, role: 'member' });

      await user.click(screen.getByRole('menuitem', { name: 'Quitter le groupe' }));

      // Même vestige : aucune conversation n'est stockée ni rattachée à un
      // groupe, seule l'organisation l'est.
      expect(screen.getByRole('dialog')).not.toHaveTextContent(/conversation/i);
    });

    it('annonce « ID copié ! » seulement une fois le presse-papiers réellement écrit', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const user = await openMenu();
      mockClipboard(writeText);

      await user.click(screen.getByRole('menuitem', { name: "Copier l'ID du groupe" }));

      expect(await screen.findByRole('menuitem', { name: 'ID copié !' })).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(TEST_GROUP.id);
    });

    it("n'annonce pas la copie quand l'écriture presse-papiers échoue, et laisse le menu ouvert pour retenter", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('not allowed'));
      const user = await openMenu();
      mockClipboard(writeText);

      await user.click(screen.getByRole('menuitem', { name: "Copier l'ID du groupe" }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(TEST_GROUP.id));
      expect(screen.queryByRole('menuitem', { name: 'ID copié !' })).not.toBeInTheDocument();
      // Échec silencieux, comme `CopyLinkButton` (MAN-198) : pas d'état
      // d'erreur dédié, mais l'entrée de menu reste là pour un nouveau clic.
      expect(screen.getByRole('menuitem', { name: "Copier l'ID du groupe" })).toBeInTheDocument();
    });
  });
});
