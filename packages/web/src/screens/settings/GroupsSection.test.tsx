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
import { render, screen, within } from '@testing-library/react';
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
let groupsError = false;

// `useCreateGroup` mocké ici (plutôt que le vrai hook comme dans
// `GroupsSection.integration.test.tsx`) : ce fichier ne teste que
// l'assemblage `GroupsSection` ↔ mutation (bons arguments, bon
// enchaînement UI), pas la vraie invalidation de cache réseau — ça, c'est
// le rôle de `GroupsSection.create.integration.test.tsx` (MAN-194 Phase 3).
let createGroupMutateAsync = vi.fn(
  (input: { name: string }): Promise<Group> =>
    Promise.resolve({
      id: 'new-group-id',
      name: input.name,
      createdBy: 'someone',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: 'owner',
    }),
);
let createGroupPending = false;

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({
      data: groupsError ? undefined : groupsState,
      isPending: false,
      isError: groupsError,
    }),
    useCreateGroup: () => ({
      mutateAsync: createGroupMutateAsync,
      isPending: createGroupPending,
    }),
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
    groupsError = false;
    createGroupMutateAsync = vi.fn(
      (input: { name: string }): Promise<Group> =>
        Promise.resolve({
          id: 'new-group-id',
          name: input.name,
          createdBy: 'someone',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          role: 'owner',
        }),
    );
    createGroupPending = false;
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

  it('test_groups_load_error_shows_message_instead_of_empty_list', () => {
    // MAN-192 (revue) : un `GET /groups` en échec ne doit pas silencieusement
    // rendre la section comme si le viewer n'avait aucun groupe.
    groupsError = true;
    renderSection();

    expect(screen.getByText('Impossible de charger tes groupes.')).toBeInTheDocument();
    expect(screen.queryByText('Groupe Owner')).not.toBeInTheDocument();
  });

  // ─────────────── MAN-194 Phase 3 : "Créer un groupe" + état vide ───────────────

  it('test_create_group_button_visible_in_tab_header', () => {
    // Zéro groupe : le point d'entrée vit dans l'état vide (Task 2), mais
    // reste bien présent et accessible par ce libellé.
    groupsState = [];
    const { unmount } = renderSection();
    expect(screen.getByRole('button', { name: /Créer un groupe/i })).toBeInTheDocument();
    unmount();

    // Plusieurs groupes : le point d'entrée vit alors dans le header, à
    // côté du titre de section.
    groupsState = ALL_GROUPS;
    renderSection();
    expect(screen.getByRole('button', { name: /Créer un groupe/i })).toBeInTheDocument();
  });

  it('test_create_group_dialog_calls_existing_mutation', async () => {
    groupsState = ALL_GROUPS;
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Créer un groupe/i }));
    await user.type(screen.getByRole('textbox'), '  Nouvelle Bande  ');
    await user.click(screen.getByRole('button', { name: 'Créer' }));

    expect(createGroupMutateAsync).toHaveBeenCalledWith({ name: 'Nouvelle Bande' });
  });

  it('test_create_group_empty_name_shows_inline_error_and_does_not_call_mutation', async () => {
    groupsState = ALL_GROUPS;
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Créer un groupe/i }));
    await user.click(screen.getByRole('button', { name: 'Créer' }));

    expect(screen.getByText('Le nom est obligatoire.')).toBeInTheDocument();
    expect(createGroupMutateAsync).not.toHaveBeenCalled();
  });

  it('test_empty_state_shown_when_user_has_no_groups', () => {
    groupsState = [];
    renderSection();

    expect(screen.getByText("Tu n'appartiens à aucun groupe pour l'instant.")).toBeInTheDocument();
    ALL_GROUPS.forEach((g) => expect(screen.queryByText(g.name)).not.toBeInTheDocument());
    expect(screen.queryByTestId('group-members-panel')).not.toBeInTheDocument();
  });

  it('test_empty_state_highlights_create_button', () => {
    groupsState = [];
    renderSection();

    const emptyState = screen.getByTestId('groups-empty-state');
    expect(
      within(emptyState).getByRole('button', { name: /Créer un groupe/i }),
    ).toBeInTheDocument();
  });
});
