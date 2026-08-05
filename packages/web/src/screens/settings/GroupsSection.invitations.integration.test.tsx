/**
 * GroupsSection + GroupInvitationsSection — test d'intégration bout-en-bout
 * (MAN-193 Phase 2 Task 4, critère d'acceptation `settings_groups_invitations_e2e`).
 *
 * Les tests existants couvrent chacun une brique isolée :
 *  - `GroupInvitationsSection.test.tsx` : rendu pur, `@/lib/queries` mocké en
 *    bloc.
 *  - `GroupInvitationsSection.integration.test.tsx` : les VRAIS hooks
 *    d'invitations (`useListInvitations`/`useCreateInvitation`/
 *    `useRevokeInvitation`) montés seuls, `@/lib/api` mocké.
 *  - `GroupsSection.integration.test.tsx` (MAN-192) : le VRAI
 *    `GroupMembersPanel` monté sous le VRAI accordéon `GroupsSection`, mais
 *    sans jamais dérouler jusqu'aux invitations.
 *
 * Aucun des trois ne prouve que l'assemblage complet fonctionne depuis
 * l'accordéon Settings : que déplier un groupe où je suis admin révèle la
 * VRAIE section invitations, que créer/révoquer s'y reflète via une vraie
 * invalidation de cache (pas un mock de state local), et que déplier un
 * groupe où je suis simple membre ne déclenche JAMAIS le moindre appel
 * réseau `GET .../invitations` — pas seulement que l'UI n'affiche rien.
 *
 * Stratégie de mock : même niveau que `GroupsSection.integration.test.tsx`
 * pour le sommet de l'arbre (`useGroups`/`useGroupMembers` mockés depuis
 * `@/lib/queries`, tout le reste du module — dont les hooks d'invitations —
 * reste réel) COMBINÉ au niveau de `GroupInvitationsSection.integration.
 * test.tsx` pour la frontière réseau des invitations (`@/lib/api` mocké).
 * `GroupMembersPanel` et `GroupInvitationsSection` ne sont mockés nulle
 * part : c'est tout l'intérêt de ce fichier par rapport aux trois ci-dessus.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Group, GroupMember, InvitationDto } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

const VIEWER_ID = '11111111-1111-1111-1111-111111111111';

const GROUP_WHERE_ADMIN: Group = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'Groupe où je gère les invitations',
  createdBy: VIEWER_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'admin',
};
const GROUP_WHERE_MEMBER: Group = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  name: 'Groupe où je suis simple membre',
  createdBy: VIEWER_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'member',
};

const VIEWER_AS_ADMIN: GroupMember = {
  userId: VIEWER_ID,
  displayName: 'Moi',
  email: 'moi@example.com',
  avatarUrl: null,
  role: 'admin',
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

const membersByGroup: Record<string, GroupMember[]> = {
  [GROUP_WHERE_ADMIN.id]: [VIEWER_AS_ADMIN],
  [GROUP_WHERE_MEMBER.id]: [VIEWER_AS_MEMBER],
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

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

// `GroupMembersPanel` et `GroupInvitationsSection` ne sont PAS mockés ici :
// c'est tout l'intérêt de ce test par rapport aux fichiers listés en tête.
import { GroupsSection } from './GroupsSection';

const mockedApi = vi.mocked(api);

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

describe('GroupsSection + GroupInvitationsSection (intégration bout-en-bout, MAN-193 Task 4)', () => {
  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    mockedApi.mockReset();
  });

  it('test_settings_groups_invitations_e2e_admin_creates_then_revokes', async () => {
    const newInvitation: InvitationDto = {
      id: '99999999-9999-9999-9999-999999999999',
      groupId: GROUP_WHERE_ADMIN.id,
      slug: 'zzz999',
      role: 'member',
      maxUses: null,
      usedCount: 0,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };

    // 1. GET (montage de la section, groupe admin déplié) : liste vide.
    // 2. POST (clic "Créer une invitation") : renvoie le DTO créé.
    // 3. GET (refetch déclenché par l'invalidation `onSuccess` de
    //    `useCreateInvitation`) : la nouvelle invitation apparaît.
    // 4. DELETE (clic "Révoquer") : `{ ok: true }`.
    // 5. GET (refetch déclenché par l'invalidation `onSuccess` de
    //    `useRevokeInvitation`) : la MÊME invitation avec `revokedAt`
    //    renseigné — pas une liste vide, cf. le fix appliqué dans
    //    `GroupInvitationsSection.integration.test.tsx` (le backend ne
    //    filtre jamais `listInvitationsForGroup`, le filtre est côté client).
    mockedApi
      .mockResolvedValueOnce({ invitations: [] })
      .mockResolvedValueOnce({ invitation: newInvitation })
      .mockResolvedValueOnce({ invitations: [newInvitation] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        invitations: [{ ...newInvitation, revokedAt: new Date().toISOString() }],
      });

    setViewer();
    const user = userEvent.setup();
    renderSection();

    const adminGroupButton = screen.getByRole('button', {
      name: /Groupe où je gère les invitations/,
    });

    // Fermé par défaut : la vraie section invitations n'est pas montée.
    expect(screen.queryByText('Invitations')).not.toBeInTheDocument();

    await user.click(adminGroupButton);
    expect(adminGroupButton).toHaveAttribute('aria-expanded', 'true');

    expect(await screen.findByText('Invitations')).toBeInTheDocument();
    await screen.findByText('Aucune invitation active pour ce groupe.');

    await user.click(screen.getByRole('button', { name: 'Créer une invitation' }));

    const expectedLink = `${window.location.origin}/invite/${newInvitation.slug}`;
    await waitFor(() => {
      expect(screen.getByText(expectedLink)).toBeInTheDocument();
    });
    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: `/groups/${GROUP_WHERE_ADMIN.id}/invitations`,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Révoquer' }));

    await waitFor(() => {
      expect(screen.getByText('Aucune invitation active pour ce groupe.')).toBeInTheDocument();
    });
    expect(screen.queryByText(expectedLink)).not.toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: `/groups/${GROUP_WHERE_ADMIN.id}/invitations/${newInvitation.id}`,
      }),
    );
  });

  it('test_settings_groups_invitations_e2e_member_never_fetches_invitations', async () => {
    setViewer();
    const user = userEvent.setup();
    renderSection();

    const memberGroupButton = screen.getByRole('button', { name: /simple membre/ });
    await user.click(memberGroupButton);
    expect(memberGroupButton).toHaveAttribute('aria-expanded', 'true');

    expect(await screen.findByText('Réservé aux admins du groupe.')).toBeInTheDocument();
    expect(screen.queryByText('Aucune invitation active pour ce groupe.')).not.toBeInTheDocument();

    // Le critère d'acceptation explicite du ticket : un simple `member` ne
    // déclenche JAMAIS `GET .../invitations` — pas seulement "l'UI n'affiche
    // rien", une assertion sur le mock réseau lui-même.
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('test_settings_groups_invitations_e2e_two_expanded_accordions_do_not_cross_fetch', async () => {
    const adminGroupInvitation: InvitationDto = {
      id: '22222222-2222-2222-2222-222222222222',
      groupId: GROUP_WHERE_ADMIN.id,
      slug: 'abc123',
      role: 'member',
      maxUses: null,
      usedCount: 0,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };
    // Un seul GET attendu au total : celui du groupe admin. Si le groupe
    // membre déclenchait quoi que ce soit, ce mock à usage unique serait
    // consommé par le mauvais appel et l'assertion sur le lien échouerait.
    mockedApi.mockResolvedValueOnce({ invitations: [adminGroupInvitation] });

    setViewer();
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Groupe où je gère les invitations/ }));
    await user.click(screen.getByRole('button', { name: /simple membre/ }));

    const expectedLink = `${window.location.origin}/invite/${adminGroupInvitation.slug}`;
    await screen.findByText(expectedLink);
    expect(screen.getByText('Réservé aux admins du groupe.')).toBeInTheDocument();

    expect(mockedApi).toHaveBeenCalledTimes(1);
    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: `/groups/${GROUP_WHERE_ADMIN.id}/invitations`,
      }),
    );
    expect(mockedApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: `/groups/${GROUP_WHERE_MEMBER.id}/invitations` }),
    );
  });
});
