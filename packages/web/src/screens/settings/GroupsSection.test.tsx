/**
 * GroupsSection — onglet "Groupes" de Settings (MAN-192 Phase 1 Task 2).
 *
 * `GroupMembersPanel` est mocké : son propre comportement (liste des
 * membres, actions par rôle, dialogs de transfert/retrait) est déjà couvert
 * par `GroupMembersScreen.test.tsx`. Ici on ne teste que la responsabilité
 * propre de `GroupsSection` : lister TOUS les groupes du viewer (aucun
 * filtre par rôle) et gérer l'accordéon (fermé par défaut, ouverture
 * indépendante par groupe, `groupId`/`viewerRole` corrects transmis au
 * panel).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Group } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

const GROUP_OWNER: Group = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Groupe Owner',
  createdBy: '11111111-1111-1111-1111-111111111111',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};
const GROUP_ADMIN: Group = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Groupe Admin',
  createdBy: '33333333-3333-3333-3333-333333333333',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'admin',
};
const GROUP_MEMBER: Group = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Groupe Membre',
  createdBy: '44444444-4444-4444-4444-444444444444',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'member',
};

const ALL_GROUPS = [GROUP_OWNER, GROUP_ADMIN, GROUP_MEMBER];

// État piloté directement par les tests, même principe que
// `GroupMembersScreen.test.tsx` : une closure simple plutôt qu'un
// `mockReturnValue` réinitialisé entre tests.
let groupsState: Group[] = [];

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: groupsState, isLoading: false }),
  };
});

vi.mock('@/screens/app/GroupMembersPanel', () => ({
  GroupMembersPanel: ({ groupId, viewerRole }: { groupId: string; viewerRole?: string }) => (
    <div
      data-testid="group-members-panel"
      data-group-id={groupId}
      data-viewer-role={viewerRole ?? ''}
    />
  ),
}));

import { GroupsSection } from './GroupsSection';

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupsSection />
    </QueryClientProvider>,
  );
}

describe('GroupsSection', () => {
  afterEach(() => {
    groupsState = [];
  });

  it('test_groups_tab_lists_all_user_groups_including_member_only', () => {
    groupsState = ALL_GROUPS;
    renderSection();

    expect(screen.getByText('Groupe Owner')).toBeInTheDocument();
    expect(screen.getByText('Groupe Admin')).toBeInTheDocument();
    expect(screen.getByText('Groupe Membre')).toBeInTheDocument();
  });

  it('test_groups_accordion_closed_by_default', () => {
    groupsState = ALL_GROUPS;
    renderSection();

    expect(screen.queryByTestId('group-members-panel')).not.toBeInTheDocument();
  });

  it('test_expanding_a_group_renders_its_members_panel', async () => {
    groupsState = ALL_GROUPS;
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Groupe Admin/ }));

    const panel = screen.getByTestId('group-members-panel');
    expect(panel).toHaveAttribute('data-group-id', GROUP_ADMIN.id);
    expect(panel).toHaveAttribute('data-viewer-role', 'admin');

    // Les autres groupes restent fermés.
    const ownerButton = screen.getByRole('button', { name: /Groupe Owner/ });
    expect(ownerButton).toHaveAttribute('aria-expanded', 'false');
    const memberButton = screen.getByRole('button', { name: /Groupe Membre/ });
    expect(memberButton).toHaveAttribute('aria-expanded', 'false');
  });
});
