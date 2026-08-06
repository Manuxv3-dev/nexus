/**
 * GroupMembersPanel — tests (MAN-192 Phase 1 Task 3 : les actions de gestion
 * (promouvoir/rétrograder/retirer un membre, transférer la propriété) restent
 * toujours RENDUES, seulement grisées quand le viewer n'a pas le rang
 * requis — plus jamais masquées. Historiquement (avant MAN-192) ces actions
 * étaient masquées quand `!canManageRole(viewerRole, target.role)` ; ce
 * fichier couvre le nouveau contrat directement sur `GroupMembersPanel`
 * (composant réutilisable extrait de `GroupMembersScreen` en MAN-192 Task 1),
 * plutôt qu'à travers la route plein écran.
 *
 * MAN-197 : le grisage passe de `disabled` natif à `aria-disabled` + un
 * garde-fou dans le handler (`onClick`) — un `disabled` natif sort du tab
 * order, ce qui empêchait clavier/lecteur d'écran d'atteindre le `title`
 * explicatif. Les assertions ci-dessous vérifient `aria-disabled="true"` ET
 * qu'un clic sur un bouton dans cet état n'invoque pas l'action sous-jacente
 * (le navigateur ne bloque plus le clic lui-même).
 *
 * Même stratégie de mock que `GroupMembersScreen.test.tsx` : `@/lib/queries`
 * est mocké (pas d'appel réseau réel en test), `useAuth` est piloté
 * directement via `setState` (store zustand).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type { GroupMember } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

const GROUP_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID_2 = '66666666-6666-6666-6666-666666666666';

const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_ADMIN_ID = '44444444-4444-4444-4444-444444444444';
const MEMBER_ID = '55555555-5555-5555-5555-555555555555';

const OWNER: GroupMember = {
  userId: OWNER_ID,
  displayName: 'Alice (owner)',
  email: 'alice@example.com',
  avatarUrl: null,
  role: 'owner',
  joinedAt: new Date().toISOString(),
};
const ADMIN: GroupMember = {
  userId: ADMIN_ID,
  displayName: 'Bob (admin)',
  email: 'bob@example.com',
  avatarUrl: null,
  role: 'admin',
  joinedAt: new Date().toISOString(),
};
const OTHER_ADMIN: GroupMember = {
  userId: OTHER_ADMIN_ID,
  displayName: 'Carla (admin)',
  email: 'carla@example.com',
  avatarUrl: null,
  role: 'admin',
  joinedAt: new Date().toISOString(),
};
const MEMBER: GroupMember = {
  userId: MEMBER_ID,
  displayName: 'Dan (member)',
  email: 'dan@example.com',
  avatarUrl: null,
  role: 'member',
  joinedAt: new Date().toISOString(),
};

const ALL_MEMBERS = [OWNER, ADMIN, OTHER_ADMIN, MEMBER];

const { mutateAsyncMock, transferMutateAsyncMock, leaveMutateAsyncMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  transferMutateAsyncMock: vi.fn(),
  leaveMutateAsyncMock: vi.fn(),
}));

// Membres par groupe : indexé par `groupId`, pour permettre à deux instances
// du panel de porter des données indépendantes dans le même test (preuve
// d'absence d'état partagé entre instances).
let membersByGroup: Record<string, GroupMember[]> = {};

// Piloté directement par les tests qui exercent l'état `isPending` de
// `useLeaveGroup` (ex. le busy state du dialog de self-leave) — même
// principe que `membersByGroup` ci-dessus, une closure mutable plutôt qu'un
// `vi.fn().mockReturnValue` reconfiguré par test.
let leaveGroupPending = false;

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroupMembers: (groupId: string | undefined) => ({
      data: groupId ? (membersByGroup[groupId] ?? []) : [],
      isLoading: false,
      isError: false,
    }),
    useUpdateGroupMemberRole: () => ({
      mutateAsync: mutateAsyncMock,
      isPending: false,
    }),
    useTransferGroupOwnership: () => ({
      mutateAsync: transferMutateAsyncMock,
      isPending: false,
    }),
    useLeaveGroup: () => ({
      mutateAsync: leaveMutateAsyncMock,
      isPending: leaveGroupPending,
    }),
  };
});

import { GroupMembersPanel } from './GroupMembersPanel';

function renderPanel(groupId: string, viewerRole: GroupMember['role'] | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupMembersPanel groupId={groupId} viewerRole={viewerRole} />
    </QueryClientProvider>,
  );
}

/**
 * Récupère la `<li>` d'un membre à partir de son nom affiché. Évite les
 * assertions non-null (`!`) répétées sur `closest('li')` — throw
 * explicitement si la structure DOM attendue (nom dans une ligne `<li>`)
 * n'est pas respectée, plutôt que de forcer le typage.
 */
function getRow(container: HTMLElement, displayName: string): HTMLElement {
  const row = within(container).getByText(displayName).closest('li');
  if (!row) throw new Error(`Aucune <li> trouvée pour "${displayName}"`);
  return row;
}

function setViewer(userId: string) {
  useAuth.setState({
    user: {
      id: userId,
      email: 'viewer@example.com',
      displayName: 'Viewer',
      avatarUrl: null,
      themePreference: null,
      landingPreference: 'home',
      onboardingStep: null,
      onboardingCompletedAt: null,
      createdAt: new Date().toISOString(),
    },
    initializing: false,
  });
}

describe('GroupMembersPanel', () => {
  beforeEach(() => {
    membersByGroup = { [GROUP_ID]: ALL_MEMBERS, [GROUP_ID_2]: ALL_MEMBERS };
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    mutateAsyncMock.mockReset();
    transferMutateAsyncMock.mockReset();
    leaveMutateAsyncMock.mockReset();
    leaveGroupPending = false;
  });

  it('test_actions_disabled_not_hidden_when_viewer_lacks_rank', async () => {
    setViewer(MEMBER_ID);
    const user = userEvent.setup();
    const { container } = renderPanel(GROUP_ID, 'member');

    // Un viewer `member` n'a un rang suffisant sur aucune cible : les
    // actions restent visibles (et focusables, cf. MAN-197) sur toutes les
    // autres lignes, mais `aria-disabled` — jamais absentes ni retirées du
    // tab order via `disabled` natif (ce qui empêcherait clavier/lecteur
    // d'écran d'atteindre le `title` explicatif).
    for (const target of [OWNER, ADMIN, OTHER_ADMIN]) {
      const row = getRow(container, target.displayName);
      const roleButton = within(row).getByRole('button', {
        name: target.role === 'member' ? 'Promouvoir admin' : 'Rétrograder membre',
      });
      expect(roleButton).toBeInTheDocument();
      expect(roleButton).toHaveAttribute('aria-disabled', 'true');
      // Le but même de MAN-197 : `aria-disabled` grise visuellement, mais ne
      // sort JAMAIS du tab order (contrairement à `disabled` natif) — c'est
      // ce qui permet à un lecteur d'écran/clavier d'atteindre le `title`.
      expect(roleButton).not.toBeDisabled();

      const removeButton = within(row).getByRole('button', { name: 'Retirer' });
      expect(removeButton).toBeInTheDocument();
      expect(removeButton).toHaveAttribute('aria-disabled', 'true');
      expect(removeButton).not.toBeDisabled();
    }

    // Le bouton reste focusable par le navigateur (ce n'est plus un
    // `disabled` natif) : c'est `Button` (MAN-208, `softDisabled` dérivé de
    // `aria-disabled`) qui avale le clic et empêche l'action, pas un
    // garde-fou écrit à la main dans le handler de ce composant (supprimé
    // par MAN-208, devenu redondant).
    const ownerRow = getRow(container, OWNER.displayName);
    await user.click(within(ownerRow).getByRole('button', { name: 'Rétrograder membre' }));
    expect(mutateAsyncMock).not.toHaveBeenCalled();

    await user.click(within(ownerRow).getByRole('button', { name: 'Retirer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('test_actions_enabled_when_viewer_has_sufficient_rank', async () => {
    setViewer(ADMIN_ID);
    const user = userEvent.setup();
    const { container } = renderPanel(GROUP_ID, 'admin');

    // Un admin gère un member (rang strictement inférieur) : actions actives.
    // `toBeEnabled()` (jest-dom) ne regarde que l'attribut natif `disabled` —
    // ces boutons n'en portent plus jamais (cf. MAN-197), donc l'assertion
    // pertinente ici est sur `aria-disabled="false"`, pas `toBeEnabled()` qui
    // serait vacuously true dans tous les états.
    const memberRow = getRow(container, 'Dan (member)');
    const promoteBtn = within(memberRow).getByRole('button', { name: 'Promouvoir admin' });
    const removeBtn = within(memberRow).getByRole('button', { name: 'Retirer' });
    expect(promoteBtn).toHaveAttribute('aria-disabled', 'false');
    expect(removeBtn).toHaveAttribute('aria-disabled', 'false');
    // Toujours dans le tab order (jamais `disabled` natif), même actif — le
    // but même de MAN-197.
    expect(promoteBtn).not.toBeDisabled();
    expect(removeBtn).not.toBeDisabled();

    // Preuve que le chemin "actionnable" fonctionne réellement (pas
    // seulement que l'attribut est correct) : le clic invoque bien la
    // mutation sous-jacente.
    mutateAsyncMock.mockResolvedValue({ ...MEMBER, role: 'admin' });
    await user.click(promoteBtn);
    expect(mutateAsyncMock).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      userId: MEMBER_ID,
      role: 'admin',
    });

    // Rang égal (autre admin) : actions présentes mais `aria-disabled`.
    const otherAdminRow = getRow(container, 'Carla (admin)');
    expect(
      within(otherAdminRow).getByRole('button', { name: 'Rétrograder membre' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(within(otherAdminRow).getByRole('button', { name: 'Retirer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Rang supérieur (owner) : actions présentes mais `aria-disabled`.
    const ownerRow = getRow(container, 'Alice (owner)');
    expect(within(ownerRow).getByRole('button', { name: 'Rétrograder membre' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(ownerRow).getByRole('button', { name: 'Retirer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Jamais sur sa propre ligne : contrairement au grisage par rang
    // ci-dessus, les actions promouvoir/rétrograder/retirer y sont
    // entièrement SUPPRIMÉES (pas seulement désactivées) — le backend
    // autorise le self-leave via sa propre action dédiée (MAN-196, cf.
    // tests plus bas), un bouton "Retirer" disabled y mentirait (cf. JSDoc
    // en tête de `GroupMembersPanel.tsx`).
    const selfRow = getRow(container, 'Bob (admin)');
    expect(
      within(selfRow).queryByRole('button', { name: 'Rétrograder membre' }),
    ).not.toBeInTheDocument();
    expect(within(selfRow).queryByRole('button', { name: 'Retirer' })).not.toBeInTheDocument();
  });

  it('test_transfer_ownership_button_disabled_for_non_owner', async () => {
    setViewer(ADMIN_ID);
    const user = userEvent.setup();
    renderPanel(GROUP_ID, 'admin');

    const transferButton = screen.getByRole('button', { name: 'Transférer la propriété' });
    expect(transferButton).toBeInTheDocument();
    expect(transferButton).toHaveAttribute('aria-disabled', 'true');

    // Cliquable par le navigateur (plus de `disabled` natif) : le
    // garde-fou du handler doit empêcher l'ouverture du dialog de transfert.
    await user.click(transferButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('test_transfer_ownership_button_enabled_for_owner_with_candidates', () => {
    setViewer(OWNER_ID);
    renderPanel(GROUP_ID, 'owner');

    const transferButton = screen.getByRole('button', { name: 'Transférer la propriété' });
    expect(transferButton).toBeInTheDocument();
    // `toBeEnabled()` regarde uniquement l'attribut natif `disabled`, que ce
    // bouton ne porte plus jamais (MAN-197) : `aria-disabled="false"` est la
    // vraie assertion, `not.toBeDisabled()` prouve qu'il reste dans le tab
    // order.
    expect(transferButton).toHaveAttribute('aria-disabled', 'false');
    expect(transferButton).not.toBeDisabled();
  });

  it('test_same_component_shows_different_states_for_different_groups', () => {
    setViewer(OWNER_ID);
    const ownerPanel = renderPanel(GROUP_ID, 'owner');
    const memberPanel = renderPanel(GROUP_ID_2, 'member');

    // Instance "owner" : transfert de propriété actif, actions de rôle
    // actives sur les cibles de rang inférieur.
    const ownerTransferButton = within(ownerPanel.container).getByRole('button', {
      name: 'Transférer la propriété',
    });
    expect(ownerTransferButton).toHaveAttribute('aria-disabled', 'false');
    const ownerMemberRow = getRow(ownerPanel.container, 'Dan (member)');
    expect(
      within(ownerMemberRow).getByRole('button', { name: 'Promouvoir admin' }),
    ).toHaveAttribute('aria-disabled', 'false');

    // Instance "member" (autre groupe, même DOM global) : le bouton de
    // transfert reste rendu (jamais masqué) mais désactivé, tout comme les
    // actions de rôle. Preuve qu'aucun état partagé ne fait fuiter l'état
    // "owner" de la première instance vers la seconde : les deux boutons
    // "Transférer la propriété" coexistent dans le DOM avec des états
    // `aria-disabled` opposés (jamais `disabled` natif, cf. MAN-197).
    const memberTransferButton = within(memberPanel.container).getByRole('button', {
      name: 'Transférer la propriété',
    });
    expect(memberTransferButton).toHaveAttribute('aria-disabled', 'true');
    const memberMemberRow = getRow(memberPanel.container, 'Dan (member)');
    expect(
      within(memberMemberRow).getByRole('button', { name: 'Promouvoir admin' }),
    ).toHaveAttribute('aria-disabled', 'true');

    ownerPanel.unmount();
    memberPanel.unmount();
  });

  it('test_no_actions_rendered_while_viewer_role_unknown', () => {
    // `viewerRole` undefined (ex. query pas encore résolue côté appelant) :
    // aucune action de gestion n'est proposée, même comportement qu'avant
    // l'extraction — mais le bouton de transfert (owner-only) n'apparaît
    // pas non plus puisque `viewerRole !== 'owner'`.
    renderPanel(GROUP_ID, undefined);

    expect(
      screen.queryByRole('button', { name: 'Transférer la propriété' }),
    ).not.toBeInTheDocument();
    for (const member of ALL_MEMBERS) {
      const row = screen.getByText(member.displayName).closest('li');
      if (!row) throw new Error(`Aucune <li> trouvée pour "${member.displayName}"`);
      expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    }
  });

  it('test_promote_button_calls_role_endpoint_and_reflects_change', async () => {
    setViewer(OWNER_ID);
    mutateAsyncMock.mockResolvedValue({ ...MEMBER, role: 'admin' });
    const user = userEvent.setup();
    const { container } = renderPanel(GROUP_ID, 'owner');

    const memberRow = getRow(container, 'Dan (member)');
    const promoteBtn = within(memberRow).getByRole('button', { name: 'Promouvoir admin' });
    await user.click(promoteBtn);

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      userId: MEMBER_ID,
      role: 'admin',
    });

    await waitFor(() => {
      expect(within(memberRow).getByText('Admin')).toBeInTheDocument();
    });
  });

  it('test_role_toggle_pending_state_has_accessible_name_and_aria_busy', async () => {
    // Régression relevée en revue : mi-mutation, le libellé visible devient
    // '…' — sans `aria-busy`/`aria-label`, un clavier/lecteur d'écran
    // n'aurait aucun contexte sur ce bouton (avant MAN-197 cet état était
    // `disabled` natif, donc inatteignable ; ce n'est plus le cas).
    setViewer(OWNER_ID);
    const user = userEvent.setup();
    let resolveMutation!: (value: GroupMember) => void;
    mutateAsyncMock.mockReturnValue(
      new Promise<GroupMember>((resolve) => {
        resolveMutation = resolve;
      }),
    );
    const { container } = renderPanel(GROUP_ID, 'owner');

    const memberRow = getRow(container, 'Dan (member)');
    const promoteBtn = within(memberRow).getByRole('button', { name: 'Promouvoir admin' });
    await user.click(promoteBtn);

    expect(promoteBtn).toHaveAttribute('aria-busy', 'true');
    expect(promoteBtn).toHaveAttribute('aria-label', 'Promouvoir admin en cours…');
    expect(promoteBtn).toHaveAccessibleName('Promouvoir admin en cours…');
    // Toujours pas de `disabled` natif pendant la mutation : reste dans le
    // tab order.
    expect(promoteBtn).not.toBeDisabled();

    // MAN-208 (revue) : `isPending` fait partie de la condition
    // `softDisabled` du bouton (`!canManage || isPending`), pas seulement
    // `canManage` — un second clic pendant que la mutation est encore en
    // vol ne doit PAS déclencher un second PATCH .../role. Avant MAN-208,
    // c'était le `if (!canManage || isPending) return;` du handler qui
    // portait cette garde ; elle est désormais uniquement portée par
    // `Button` via `softDisabled`, cf. `GroupMembersPanel.tsx`.
    await user.click(promoteBtn);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);

    resolveMutation({ ...MEMBER, role: 'admin' });
    await waitFor(() => {
      expect(promoteBtn).toHaveAttribute('aria-busy', 'false');
    });
  });

  it('test_leave_button_shown_on_self_row_for_non_owner_viewers', () => {
    setViewer(ADMIN_ID);
    const { container: adminContainer } = renderPanel(GROUP_ID, 'admin');
    const adminSelfRow = getRow(adminContainer, 'Bob (admin)');
    expect(
      within(adminSelfRow).getByRole('button', { name: 'Quitter le groupe' }),
    ).toBeInTheDocument();

    setViewer(MEMBER_ID);
    const { container: memberContainer } = renderPanel(GROUP_ID_2, 'member');
    const memberSelfRow = getRow(memberContainer, 'Dan (member)');
    expect(
      within(memberSelfRow).getByRole('button', { name: 'Quitter le groupe' }),
    ).toBeInTheDocument();
  });

  it('test_leave_button_hidden_on_self_row_for_owner_viewer', () => {
    setViewer(OWNER_ID);
    const { container } = renderPanel(GROUP_ID, 'owner');
    const ownerSelfRow = getRow(container, 'Alice (owner)');

    expect(
      within(ownerSelfRow).queryByRole('button', { name: 'Quitter le groupe' }),
    ).not.toBeInTheDocument();
    expect(
      within(ownerSelfRow).getByText(/Transfère la propriété avant de quitter/),
    ).toBeInTheDocument();
  });

  it('test_leave_button_opens_confirmation_and_cancel_does_not_call_mutation', async () => {
    setViewer(ADMIN_ID);
    const user = userEvent.setup();
    const { container } = renderPanel(GROUP_ID, 'admin');
    const selfRow = getRow(container, 'Bob (admin)');

    await user.click(within(selfRow).getByRole('button', { name: 'Quitter le groupe' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Quitter le groupe' })).toBeInTheDocument();
    expect(leaveMutateAsyncMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(leaveMutateAsyncMock).not.toHaveBeenCalled();
  });

  it('test_leave_confirmation_calls_leave_group_with_self_ids', async () => {
    setViewer(ADMIN_ID);
    leaveMutateAsyncMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container } = renderPanel(GROUP_ID, 'admin');
    const selfRow = getRow(container, 'Bob (admin)');

    await user.click(within(selfRow).getByRole('button', { name: 'Quitter le groupe' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Quitter le groupe' }));

    expect(leaveMutateAsyncMock).toHaveBeenCalledWith({ groupId: GROUP_ID, userId: ADMIN_ID });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('test_failed_leave_shows_inline_error_and_keeps_dialog_open', async () => {
    setViewer(ADMIN_ID);
    leaveMutateAsyncMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    const { container } = renderPanel(GROUP_ID, 'admin');
    const selfRow = getRow(container, 'Bob (admin)');

    await user.click(within(selfRow).getByRole('button', { name: 'Quitter le groupe' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Quitter le groupe' }));

    await waitFor(() => {
      expect(
        within(dialog).getByText(/Impossible de quitter le groupe pour l'instant/),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('test_self_row_shows_no_leave_button_or_owner_hint_when_viewer_role_unknown', () => {
    // `viewerRole` undefined (rôle pas encore résolu côté appelant) : même
    // sur sa propre ligne, ni le bouton "Quitter le groupe" (non-owner) ni
    // le texte d'aide owner ne doivent apparaître — `showActions` couvre ce
    // cas comme toutes les autres actions de gestion (cf.
    // `test_no_actions_rendered_while_viewer_role_unknown` ci-dessus).
    setViewer(ADMIN_ID);
    const { container } = renderPanel(GROUP_ID, undefined);
    const selfRow = getRow(container, 'Bob (admin)');

    expect(
      within(selfRow).queryByRole('button', { name: 'Quitter le groupe' }),
    ).not.toBeInTheDocument();
    expect(
      within(selfRow).queryByText(/Transfère la propriété avant de quitter/),
    ).not.toBeInTheDocument();
    expect(
      within(selfRow).queryByText(/Supprime le groupe pour le quitter/),
    ).not.toBeInTheDocument();
  });

  it('test_leave_dialog_busy_state_shows_pending_label_and_disables_cancel', async () => {
    setViewer(ADMIN_ID);
    leaveGroupPending = true;
    const user = userEvent.setup();
    const { container } = renderPanel(GROUP_ID, 'admin');
    const selfRow = getRow(container, 'Bob (admin)');

    await user.click(within(selfRow).getByRole('button', { name: 'Quitter le groupe' }));
    const dialog = screen.getByRole('dialog');

    const confirmButton = within(dialog).getByRole('button', { name: 'Sortie…' });
    expect(confirmButton).toBeInTheDocument();
    expect(confirmButton).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeDisabled();
  });
});
