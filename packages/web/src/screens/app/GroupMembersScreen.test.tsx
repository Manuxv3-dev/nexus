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

const { mutateAsyncMock, transferMutateAsyncMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  transferMutateAsyncMock: vi.fn(),
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

  it('test_promote_button_visible_only_for_manageable_targets', () => {
    setViewer(ADMIN_ID);
    renderScreen();

    const memberRow = getRow('Dan (member)');
    expect(within(memberRow).getByRole('button')).toBeInTheDocument();

    const otherAdminRow = getRow('Carla (admin)');
    expect(within(otherAdminRow).queryByRole('button')).not.toBeInTheDocument();

    const ownerRow = getRow('Alice (owner)');
    expect(within(ownerRow).queryByRole('button')).not.toBeInTheDocument();

    // Pas d'action sur sa propre ligne non plus.
    const selfRow = getRow('Bob (admin)');
    expect(within(selfRow).queryByRole('button')).not.toBeInTheDocument();
  });

  it('test_member_role_sees_no_action_buttons', () => {
    setViewer(MEMBER_ID);
    renderScreen();

    for (const member of ALL_MEMBERS) {
      const row = getRow(member.displayName);
      expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    }
  });

  it('test_promote_button_calls_role_endpoint_and_reflects_change', async () => {
    setViewer(OWNER_ID);
    mutateAsyncMock.mockResolvedValue({ ...MEMBER, role: 'admin' });
    const user = userEvent.setup();
    renderScreen();

    const memberRow = getRow('Dan (member)');
    const promoteBtn = within(memberRow).getByRole('button');
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

  it('test_transfer_action_visible_only_for_owner', () => {
    setViewer(ADMIN_ID);
    const admin = renderScreen();
    expect(
      screen.queryByRole('button', { name: 'Transférer la propriété' }),
    ).not.toBeInTheDocument();
    admin.unmount();

    setViewer(MEMBER_ID);
    const member = renderScreen();
    expect(
      screen.queryByRole('button', { name: 'Transférer la propriété' }),
    ).not.toBeInTheDocument();
    member.unmount();

    setViewer(OWNER_ID);
    renderScreen();
    expect(screen.getByRole('button', { name: 'Transférer la propriété' })).toBeInTheDocument();
  });

  it('test_transfer_action_hidden_when_no_other_members', () => {
    membersState = [OWNER];
    setViewer(OWNER_ID);
    renderScreen();

    const transferButton = screen.getByRole('button', { name: 'Transférer la propriété' });
    expect(transferButton).toBeDisabled();
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
});
