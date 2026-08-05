/**
 * GroupsSection — test d'intégration (MAN-192 Phase 1 Task 4).
 *
 * `GroupsSection.test.tsx` mocke `GroupMembersPanel` (il ne prouve que la
 * responsabilité propre de `GroupsSection` : lister les groupes, gérer
 * l'accordéon). `GroupMembersPanel.test.tsx` teste le panel seul, monté
 * directement avec des props contrôlées. Aucun des deux ne prouve que
 * l'assemblage réel fonctionne : que `GroupsSection` transmette bien
 * `groupId`/`viewerRole` au VRAI `GroupMembersPanel` une fois déplié, et que
 * le grisage par rang (MAN-192 Task 3) se comporte différemment selon le
 * groupe déplié — y compris quand deux instances du panel sont montées en
 * même temps sous des accordéons distincts (pas de fuite d'état entre elles).
 *
 * Seuls `useGroups` et `useGroupMembers` sont mockés (pas d'appel réseau réel
 * en test). Les hooks de mutation (`useUpdateGroupMemberRole`,
 * `useTransferGroupOwnership`, `useLeaveGroup`) restent les vrais : ce test
 * ne clique sur aucune action, seul leur état `disabled`/`enabled` est vérifié,
 * donc leur `mutationFn` réelle n'est jamais invoquée.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type { Group, GroupMember } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

const VIEWER_ID = '11111111-1111-1111-1111-111111111111';
const LOWER_MEMBER_ID = '22222222-2222-2222-2222-222222222222';
const PEER_MEMBER_ID = '33333333-3333-3333-3333-333333333333';

const GROUP_WHERE_ADMIN: Group = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'Groupe où je suis admin',
  createdBy: VIEWER_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'admin',
};
const GROUP_WHERE_MEMBER: Group = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  name: 'Groupe où je suis simple membre',
  createdBy: PEER_MEMBER_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'member',
};

// Même viewer (`VIEWER_ID`), rôle différent selon le groupe — situation
// réaliste (rôle par groupe, pas global) et cas exact que doit distinguer
// l'intégration `GroupsSection` + `GroupMembersPanel`.
const VIEWER_AS_ADMIN: GroupMember = {
  userId: VIEWER_ID,
  displayName: 'Moi',
  email: 'moi@example.com',
  avatarUrl: null,
  role: 'admin',
  joinedAt: new Date().toISOString(),
};
const LOWER_MEMBER: GroupMember = {
  userId: LOWER_MEMBER_ID,
  displayName: 'Léo (membre à gérer)',
  email: 'leo@example.com',
  avatarUrl: null,
  role: 'member',
  joinedAt: new Date().toISOString(),
};
const VIEWER_AS_MEMBER: GroupMember = {
  userId: VIEWER_ID,
  displayName: 'Moi',
  email: 'moi@example.com',
  avatarUrl: null,
  role: 'member',
  joinedAt: new Date().toISOString(),
};
const PEER_MEMBER: GroupMember = {
  userId: PEER_MEMBER_ID,
  displayName: 'Nadia (pair)',
  email: 'nadia@example.com',
  avatarUrl: null,
  role: 'member',
  joinedAt: new Date().toISOString(),
};

const membersByGroup: Record<string, GroupMember[]> = {
  [GROUP_WHERE_ADMIN.id]: [VIEWER_AS_ADMIN, LOWER_MEMBER],
  [GROUP_WHERE_MEMBER.id]: [VIEWER_AS_MEMBER, PEER_MEMBER],
};

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [GROUP_WHERE_ADMIN, GROUP_WHERE_MEMBER], isLoading: false }),
    useGroupMembers: (groupId: string | undefined) => ({
      data: groupId ? (membersByGroup[groupId] ?? []) : [],
      isLoading: false,
      isError: false,
    }),
  };
});

// `GroupMembersPanel` n'est PAS mocké ici : c'est tout l'intérêt de ce test
// par rapport à `GroupsSection.test.tsx`.
import { GroupsSection } from './GroupsSection';

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupsSection />
    </QueryClientProvider>,
  );
}

function setViewer() {
  useAuth.setState({
    user: {
      id: VIEWER_ID,
      email: 'moi@example.com',
      displayName: 'Moi',
      avatarUrl: null,
      themePreference: null,
      landingPreference: 'home',
      createdAt: new Date().toISOString(),
    },
    initializing: false,
  });
}

function getRow(displayName: string): HTMLElement {
  const row = screen.getByText(displayName).closest('li');
  if (!row) throw new Error(`Aucune <li> trouvée pour "${displayName}"`);
  return row;
}

describe('GroupsSection + GroupMembersPanel (intégration réelle)', () => {
  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  it('test_expanding_each_group_renders_the_real_panel_with_role_appropriate_actions', async () => {
    setViewer();
    const user = userEvent.setup();
    renderSection();

    const adminGroupButton = screen.getByRole('button', { name: /Groupe où je suis admin/ });
    const memberGroupButton = screen.getByRole('button', { name: /simple membre/ });

    // 1. Fermé par défaut : ni l'un ni l'autre accordéon n'a de contenu, donc
    // aucune des deux listes de membres réelles n'est dans le DOM.
    expect(adminGroupButton).toHaveAttribute('aria-expanded', 'false');
    expect(memberGroupButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Léo (membre à gérer)')).not.toBeInTheDocument();
    expect(screen.queryByText('Nadia (pair)')).not.toBeInTheDocument();

    // 2. Déplie le groupe où je suis admin : le VRAI GroupMembersPanel
    // s'affiche avec sa vraie liste de membres, et l'action sur un membre de
    // rang inférieur est rendue ET active.
    await user.click(adminGroupButton);
    expect(adminGroupButton).toHaveAttribute('aria-expanded', 'true');
    expect(memberGroupButton).toHaveAttribute('aria-expanded', 'false');

    const leoRow = getRow('Léo (membre à gérer)');
    const promoteLeoBtn = within(leoRow).getByRole('button', { name: 'Promouvoir admin' });
    expect(promoteLeoBtn).toBeInTheDocument();
    expect(promoteLeoBtn).toBeEnabled();
    const removeLeoBtn = within(leoRow).getByRole('button', { name: 'Retirer' });
    expect(removeLeoBtn).toBeInTheDocument();
    expect(removeLeoBtn).toBeEnabled();

    // L'autre groupe reste fermé : sa liste réelle n'est toujours pas montée.
    expect(screen.queryByText('Nadia (pair)')).not.toBeInTheDocument();

    // 3. Replie le groupe admin, déplie l'autre où je suis simple membre :
    // le VRAI panel réaffiche la même mécanique (rendu + grisage), mais cette
    // fois l'action est désactivée puisque je n'ai pas le rang requis.
    await user.click(adminGroupButton);
    expect(adminGroupButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Léo (membre à gérer)')).not.toBeInTheDocument();

    await user.click(memberGroupButton);
    expect(memberGroupButton).toHaveAttribute('aria-expanded', 'true');

    const nadiaRow = getRow('Nadia (pair)');
    const promoteNadiaBtn = within(nadiaRow).getByRole('button', { name: 'Promouvoir admin' });
    expect(promoteNadiaBtn).toBeInTheDocument();
    expect(promoteNadiaBtn).toBeDisabled();
    const removeNadiaBtn = within(nadiaRow).getByRole('button', { name: 'Retirer' });
    expect(removeNadiaBtn).toBeInTheDocument();
    expect(removeNadiaBtn).toBeDisabled();

    // 4. Déplie à nouveau le groupe admin EN PLUS de l'autre (le Set d'ids
    // ouverts permet plusieurs accordéons ouverts simultanément) : les deux
    // vraies instances de GroupMembersPanel coexistent dans le DOM, chacune
    // avec son propre état de grisage — preuve qu'aucun état n'est partagé
    // entre elles (pas de fuite groupId/viewerRole d'une instance à l'autre).
    await user.click(adminGroupButton);
    expect(adminGroupButton).toHaveAttribute('aria-expanded', 'true');
    expect(memberGroupButton).toHaveAttribute('aria-expanded', 'true');

    const leoRowAgain = getRow('Léo (membre à gérer)');
    expect(within(leoRowAgain).getByRole('button', { name: 'Promouvoir admin' })).toBeEnabled();
    const nadiaRowStillThere = getRow('Nadia (pair)');
    expect(
      within(nadiaRowStillThere).getByRole('button', { name: 'Promouvoir admin' }),
    ).toBeDisabled();
  });
});
