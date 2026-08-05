/**
 * GroupMembersScreen — tests (MAN-180 Phase 1 Task 4 : liste des membres du
 * groupe + promotion/rétrogradation de rôle).
 *
 * On mocke `@tanstack/react-router` (pas de RouterProvider réel nécessaire,
 * même principe que SettingsScreen.test.tsx / GroupMenu.test.tsx) et
 * `@/lib/queries` (pas d'appel réseau réel en test). `useAuth` est un store
 * zustand : piloté directement via `setState`, pas besoin de mock de module.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type { GroupMember } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

const TEST_GROUP_ID = '22222222-2222-2222-2222-222222222222';

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

// État piloté directement par les tests (pas de `vi.fn().mockReturnValue` —
// même principe que `SettingsScreen.test.tsx` : une closure simple évite les
// subtilités de cycle de vie d'un mock `vi.fn` réinitialisé entre tests).
let membersState: GroupMember[] = [];

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ groupId: TEST_GROUP_ID }),
  };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroupMembers: () => ({ data: membersState, isLoading: false, isError: false }),
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
      isPending: false,
    }),
  };
});

import { GroupMembersScreen } from './GroupMembersScreen';

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupMembersScreen />
    </QueryClientProvider>,
  );
}

/**
 * Récupère la `<li>` d'un membre à partir de son nom affiché. Évite les
 * assertions non-null (`!`) répétées sur `closest('li')` — throw
 * explicitement si la structure DOM attendue (nom dans une ligne `<li>`)
 * n'est pas respectée, plutôt que de forcer le typage.
 */
function getRow(displayName: string): HTMLElement {
  const row = screen.getByText(displayName).closest('li');
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
      createdAt: new Date().toISOString(),
    },
    initializing: false,
  });
}

describe('GroupMembersScreen', () => {
  beforeEach(() => {
    membersState = ALL_MEMBERS;
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    mutateAsyncMock.mockReset();
    transferMutateAsyncMock.mockReset();
    leaveMutateAsyncMock.mockReset();
  });

  it('test_members_screen_lists_all_members_with_roles', () => {
    setViewer(MEMBER_ID);
    renderScreen();

    for (const member of ALL_MEMBERS) {
      const row = screen.getByText(member.displayName).closest('li');
      expect(row).not.toBeNull();
    }

    expect(within(getRow('Alice (owner)')).getByText('Propriétaire')).toBeInTheDocument();
    expect(within(getRow('Bob (admin)')).getByText('Admin')).toBeInTheDocument();
    expect(within(getRow('Dan (member)')).getByText('Membre')).toBeInTheDocument();
  });

  it('test_no_skipped_heading_level_between_h1_and_the_invitations_h2 (MAN-198 Item 3b)', () => {
    setViewer(MEMBER_ID);
    renderScreen();

    // h1 "Membres du groupe" (chrome de page) → h2 "Membres" (liste, cf.
    // GroupMembersPanel) → h2 "Invitations" (sibling, pas enfant, cf.
    // GroupInvitationsSection) : aucun saut de niveau, contrairement à
    // l'ancien h1 → h3 direct (violation axe `heading-order`).
    expect(
      screen.getByRole('heading', { level: 1, name: 'Membres du groupe' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Membres' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Invitations' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('test_promote_button_enabled_only_for_manageable_targets', () => {
    // MAN-192 Phase 1 Task 3 : les actions restent toujours rendues, seul
    // leur état `disabled` reflète le rang du viewer — plus de masquage.
    setViewer(ADMIN_ID);
    renderScreen();

    const memberRow = getRow('Dan (member)');
    expect(within(memberRow).getByRole('button', { name: 'Promouvoir admin' })).toBeEnabled();

    // Rang égal (autre admin) : bouton présent mais `aria-disabled` (MAN-197 :
    // plus de `disabled` natif, pour rester focusable/atteignable au clavier).
    const otherAdminRow = getRow('Carla (admin)');
    expect(
      within(otherAdminRow).getByRole('button', { name: 'Rétrograder membre' }),
    ).toHaveAttribute('aria-disabled', 'true');

    // Rang supérieur (owner) : bouton présent mais `aria-disabled`.
    const ownerRow = getRow('Alice (owner)');
    expect(within(ownerRow).getByRole('button', { name: 'Rétrograder membre' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Jamais sur sa propre ligne : les actions y sont entièrement
    // supprimées (pas seulement désactivées) — cf. JSDoc de
    // `GroupMembersPanel.tsx`.
    const selfRow = getRow('Bob (admin)');
    expect(
      within(selfRow).queryByRole('button', { name: 'Rétrograder membre' }),
    ).not.toBeInTheDocument();
  });

  it('test_member_role_sees_all_action_buttons_disabled', async () => {
    setViewer(MEMBER_ID);
    const user = userEvent.setup();
    renderScreen();

    // Sur toutes les lignes AUTRES que la sienne, un viewer `member` n'a le
    // rang suffisant sur personne : actions rendues mais `aria-disabled`
    // (MAN-197 : plus de `disabled` natif).
    for (const member of ALL_MEMBERS.filter((m) => m.userId !== MEMBER_ID)) {
      const row = getRow(member.displayName);
      for (const button of within(row).getAllByRole('button')) {
        expect(button).toHaveAttribute('aria-disabled', 'true');
      }
    }

    // Le bouton reste cliquable côté navigateur : le clic ne doit déclencher
    // ni la mutation de rôle ni l'ouverture du dialog de retrait — c'est le
    // garde-fou dans le handler qui bloque l'action, pas `disabled` natif.
    const ownerRow = getRow('Alice (owner)');
    await user.click(within(ownerRow).getByRole('button', { name: 'Rétrograder membre' }));
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    await user.click(within(ownerRow).getByRole('button', { name: 'Retirer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Sa propre ligne (Dan/MEMBER_ID) : aucune action de gestion
    // (promouvoir/rétrograder/retirer), seulement le bouton dédié
    // "Quitter le groupe" (MAN-196, viewer non-owner).
    const selfRow = getRow('Dan (member)');
    expect(
      within(selfRow).queryByRole('button', { name: 'Promouvoir admin' }),
    ).not.toBeInTheDocument();
    expect(within(selfRow).queryByRole('button', { name: 'Retirer' })).not.toBeInTheDocument();
    expect(within(selfRow).getByRole('button', { name: 'Quitter le groupe' })).toBeInTheDocument();
  });

  it('test_promote_button_calls_role_endpoint_and_reflects_change', async () => {
    setViewer(OWNER_ID);
    mutateAsyncMock.mockResolvedValue({ ...MEMBER, role: 'admin' });
    const user = userEvent.setup();
    renderScreen();

    const memberRow = getRow('Dan (member)');
    const promoteBtn = within(memberRow).getByRole('button', { name: 'Promouvoir admin' });
    await user.click(promoteBtn);

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      groupId: TEST_GROUP_ID,
      userId: MEMBER_ID,
      role: 'admin',
    });

    await waitFor(() => {
      expect(within(memberRow).getByText('Admin')).toBeInTheDocument();
    });
  });

  // ─────────────────── Transfert de propriété (MAN-181 Task 4) ───────────────────

  it('test_transfer_action_enabled_only_for_owner', async () => {
    // MAN-192 Phase 1 Task 3 : le bouton owner-only reste rendu pour tout
    // viewer, mais `aria-disabled` si `viewerRole !== 'owner'` (MAN-197 :
    // plus de `disabled` natif, garde-fou dans le handler à la place).
    setViewer(ADMIN_ID);
    const user = userEvent.setup();
    const admin = renderScreen();
    const adminTransferButton = screen.getByRole('button', { name: 'Transférer la propriété' });
    expect(adminTransferButton).toHaveAttribute('aria-disabled', 'true');
    await user.click(adminTransferButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    admin.unmount();

    setViewer(MEMBER_ID);
    const member = renderScreen();
    expect(screen.getByRole('button', { name: 'Transférer la propriété' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    member.unmount();

    setViewer(OWNER_ID);
    renderScreen();
    expect(screen.getByRole('button', { name: 'Transférer la propriété' })).toBeEnabled();
  });

  it('test_transfer_action_hidden_when_no_other_members', () => {
    membersState = [OWNER];
    setViewer(OWNER_ID);
    renderScreen();

    const transferButton = screen.getByRole('button', { name: 'Transférer la propriété' });
    expect(transferButton).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('Aucun autre membre à qui transférer la propriété.'),
    ).toBeInTheDocument();
  });

  it('test_transfer_requires_confirmation_before_calling_endpoint', async () => {
    setViewer(OWNER_ID);
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: 'Transférer la propriété' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Nouveau propriétaire'), MEMBER_ID);
    await user.click(within(dialog).getByRole('button', { name: 'Continuer' }));

    expect(transferMutateAsyncMock).not.toHaveBeenCalled();

    // Le bouton de confirmation finale doit rester distinct de "Continuer".
    expect(
      within(dialog).getByRole('button', { name: 'Confirmer le transfert' }),
    ).toBeInTheDocument();
    expect(transferMutateAsyncMock).not.toHaveBeenCalled();
  });

  it('test_transfer_calls_endpoint_and_updates_local_state', async () => {
    setViewer(OWNER_ID);
    transferMutateAsyncMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: 'Transférer la propriété' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Nouveau propriétaire'), MEMBER_ID);
    await user.click(within(dialog).getByRole('button', { name: 'Continuer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer le transfert' }));

    expect(transferMutateAsyncMock).toHaveBeenCalledWith({
      groupId: TEST_GROUP_ID,
      newOwnerUserId: MEMBER_ID,
    });

    await waitFor(() => {
      expect(within(getRow('Dan (member)')).getByText('Propriétaire')).toBeInTheDocument();
    });
    expect(within(getRow('Alice (owner)')).getByText('Admin')).toBeInTheDocument();
  });

  // ─────────────────────── Retrait / kick (MAN-182 Phase 3 Task 4) ───────────────────────

  it('test_remove_button_enabled_only_for_manageable_targets', () => {
    setViewer(ADMIN_ID);
    renderScreen();

    // Rang inférieur au viewer (admin) : bouton "Retirer" actif.
    const memberRow = getRow('Dan (member)');
    expect(within(memberRow).getByRole('button', { name: 'Retirer' })).toBeEnabled();

    // Rang égal (autre admin) : bouton "Retirer" présent mais `aria-disabled`.
    const otherAdminRow = getRow('Carla (admin)');
    expect(within(otherAdminRow).getByRole('button', { name: 'Retirer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Rang supérieur (owner) : bouton "Retirer" présent mais `aria-disabled`.
    const ownerRow = getRow('Alice (owner)');
    expect(within(ownerRow).getByRole('button', { name: 'Retirer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Jamais sur sa propre ligne : le bouton "Retirer" y est entièrement
    // supprimé (pas seulement désactivé) — cf. JSDoc de
    // `GroupMembersPanel.tsx`.
    const selfRow = getRow('Bob (admin)');
    expect(within(selfRow).queryByRole('button', { name: 'Retirer' })).not.toBeInTheDocument();
  });

  it('test_remove_button_requires_confirmation', async () => {
    setViewer(OWNER_ID);
    const user = userEvent.setup();
    renderScreen();

    const memberRow = getRow('Dan (member)');
    await user.click(within(memberRow).getByRole('button', { name: 'Retirer' }));

    // Le premier clic ouvre la confirmation, il n'appelle pas le réseau.
    expect(leaveMutateAsyncMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Retirer du groupe' })).toBeInTheDocument();
    expect(leaveMutateAsyncMock).not.toHaveBeenCalled();
  });

  it('test_remove_calls_existing_delete_endpoint_and_updates_list', async () => {
    setViewer(OWNER_ID);
    leaveMutateAsyncMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderScreen();

    const memberRow = getRow('Dan (member)');
    await user.click(within(memberRow).getByRole('button', { name: 'Retirer' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Retirer du groupe' }));

    expect(leaveMutateAsyncMock).toHaveBeenCalledWith({
      groupId: TEST_GROUP_ID,
      userId: MEMBER_ID,
    });

    await waitFor(() => {
      expect(screen.queryByText('Dan (member)')).not.toBeInTheDocument();
    });
  });
});
