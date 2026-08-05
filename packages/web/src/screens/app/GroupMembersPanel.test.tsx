/**
 * GroupMembersPanel — tests (MAN-192 Phase 1 Task 3 : les actions de gestion
 * (promouvoir/rétrograder/retirer un membre, transférer la propriété) restent
 * toujours RENDUES, seulement `disabled` quand le viewer n'a pas le rang
 * requis — plus jamais masquées. Historiquement (avant MAN-192) ces actions
 * étaient masquées quand `!canManageRole(viewerRole, target.role)` ; ce
 * fichier couvre le nouveau contrat directement sur `GroupMembersPanel`
 * (composant réutilisable extrait de `GroupMembersScreen` en MAN-192 Task 1),
 * plutôt qu'à travers la route plein écran.
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
      isPending: false,
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
  });

  it('test_actions_disabled_not_hidden_when_viewer_lacks_rank', () => {
    setViewer(MEMBER_ID);
    const { container } = renderPanel(GROUP_ID, 'member');

    // Un viewer `member` n'a un rang suffisant sur aucune cible : les
    // actions restent visibles sur toutes les autres lignes, mais
    // désactivées — jamais absentes.
    for (const target of [OWNER, ADMIN, OTHER_ADMIN]) {
      const row = getRow(container, target.displayName);
      const roleButton = within(row).getByRole('button', {
        name: target.role === 'member' ? 'Promouvoir admin' : 'Rétrograder membre',
      });
      expect(roleButton).toBeInTheDocument();
      expect(roleButton).toBeDisabled();

      const removeButton = within(row).getByRole('button', { name: 'Retirer' });
      expect(removeButton).toBeInTheDocument();
      expect(removeButton).toBeDisabled();
    }
  });

  it('test_actions_enabled_when_viewer_has_sufficient_rank', () => {
    setViewer(ADMIN_ID);
    const { container } = renderPanel(GROUP_ID, 'admin');

    // Un admin gère un member (rang strictement inférieur) : actions actives.
    const memberRow = getRow(container, 'Dan (member)');
    expect(within(memberRow).getByRole('button', { name: 'Promouvoir admin' })).toBeEnabled();
    expect(within(memberRow).getByRole('button', { name: 'Retirer' })).toBeEnabled();

    // Rang égal (autre admin) : actions présentes mais désactivées.
    const otherAdminRow = getRow(container, 'Carla (admin)');
    expect(
      within(otherAdminRow).getByRole('button', { name: 'Rétrograder membre' }),
    ).toBeDisabled();
    expect(within(otherAdminRow).getByRole('button', { name: 'Retirer' })).toBeDisabled();

    // Rang supérieur (owner) : actions présentes mais désactivées.
    const ownerRow = getRow(container, 'Alice (owner)');
    expect(within(ownerRow).getByRole('button', { name: 'Rétrograder membre' })).toBeDisabled();
    expect(within(ownerRow).getByRole('button', { name: 'Retirer' })).toBeDisabled();

    // Jamais sur sa propre ligne : contrairement au grisage par rang
    // ci-dessus, les actions y sont entièrement SUPPRIMÉES (pas seulement
    // désactivées) — le backend autorise le self-leave, un bouton "Retirer"
    // disabled y mentirait (cf. JSDoc en tête de `GroupMembersPanel.tsx`).
    const selfRow = getRow(container, 'Bob (admin)');
    expect(
      within(selfRow).queryByRole('button', { name: 'Rétrograder membre' }),
    ).not.toBeInTheDocument();
    expect(within(selfRow).queryByRole('button', { name: 'Retirer' })).not.toBeInTheDocument();
  });

  it('test_transfer_ownership_button_disabled_for_non_owner', () => {
    setViewer(ADMIN_ID);
    renderPanel(GROUP_ID, 'admin');

    const transferButton = screen.getByRole('button', { name: 'Transférer la propriété' });
    expect(transferButton).toBeInTheDocument();
    expect(transferButton).toBeDisabled();
  });

  it('test_transfer_ownership_button_enabled_for_owner_with_candidates', () => {
    setViewer(OWNER_ID);
    renderPanel(GROUP_ID, 'owner');

    const transferButton = screen.getByRole('button', { name: 'Transférer la propriété' });
    expect(transferButton).toBeInTheDocument();
    expect(transferButton).toBeEnabled();
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
    expect(ownerTransferButton).toBeEnabled();
    const ownerMemberRow = getRow(ownerPanel.container, 'Dan (member)');
    expect(within(ownerMemberRow).getByRole('button', { name: 'Promouvoir admin' })).toBeEnabled();

    // Instance "member" (autre groupe, même DOM global) : le bouton de
    // transfert reste rendu (jamais masqué) mais désactivé, tout comme les
    // actions de rôle. Preuve qu'aucun état partagé ne fait fuiter l'état
    // "owner" de la première instance vers la seconde : les deux boutons
    // "Transférer la propriété" coexistent dans le DOM avec des états
    // `disabled` opposés.
    const memberTransferButton = within(memberPanel.container).getByRole('button', {
      name: 'Transférer la propriété',
    });
    expect(memberTransferButton).toBeDisabled();
    const memberMemberRow = getRow(memberPanel.container, 'Dan (member)');
    expect(
      within(memberMemberRow).getByRole('button', { name: 'Promouvoir admin' }),
    ).toBeDisabled();

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
});
