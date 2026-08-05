/**
 * GroupInvitationsSection — test d'intégration (MAN-193 Phase 2 Task 2).
 *
 * `GroupInvitationsSection.test.tsx` mocke `@/lib/queries` en bloc : il
 * prouve le rendu (états loading/erreur/vide/liste) et les `disabled` de
 * boutons, mais rien ne garantit que le VRAI `useListInvitations` ne parte
 * jamais pour un viewer `member`, ni qu'une révocation se reflète réellement
 * dans la liste après invalidation du cache TanStack Query. Ce fichier
 * couvre ces deux points avec les VRAIS hooks (`@/lib/queries` non mocké) et
 * `api` mocké au plus bas niveau — même stratégie que
 * `queries.leaveGroup.test.tsx`/`queries.invitations.test.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import type { InvitationDto } from '@/lib/queries';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

import { GroupInvitationsSection } from './GroupInvitationsSection';

const GROUP_ID = '11111111-1111-1111-1111-111111111111';

const ACTIVE_INVITATION: InvitationDto = {
  id: '22222222-2222-2222-2222-222222222222',
  groupId: GROUP_ID,
  slug: 'abc123',
  role: 'member',
  maxUses: null,
  usedCount: 0,
  expiresAt: null,
  revokedAt: null,
  createdAt: new Date().toISOString(),
};

function renderSection(viewerRole: 'owner' | 'admin' | 'member' | undefined, qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupInvitationsSection groupId={GROUP_ID} viewerRole={viewerRole} />
    </QueryClientProvider>,
  );
}

describe('GroupInvitationsSection (intégration réelle)', () => {
  afterEach(() => {
    mockedApi.mockReset();
  });

  it('test_member_role_never_fetches_invitations', () => {
    renderSection('member');

    // Le viewer `member` n'a pas le rang requis (backend 403 sinon) : le
    // VRAI `useListInvitations` ne doit JAMAIS déclencher `api()` — pas
    // seulement "l'UI ne montre rien", mais bien aucune tentative réseau.
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('test_revoke_removes_invitation_from_list_on_success', async () => {
    // 1er GET (montage) : une invitation active. Le DELETE renvoie `{ ok:
    // true }`. Le 2e GET (déclenché par l'invalidation `onSuccess` de
    // `useRevokeInvitation`) renvoie une liste vide : c'est ce second aller-
    // retour, pas un état local, qui doit faire disparaître la ligne.
    mockedApi
      .mockResolvedValueOnce({ invitations: [ACTIVE_INVITATION] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ invitations: [] });

    const user = userEvent.setup();
    renderSection('admin');

    const expectedLink = `${window.location.origin}/invite/${ACTIVE_INVITATION.slug}`;
    await screen.findByText(expectedLink);

    await user.click(screen.getByRole('button', { name: 'Révoquer' }));

    await waitFor(() => {
      expect(screen.getByText('Aucune invitation active pour ce groupe.')).toBeInTheDocument();
    });
    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: `/groups/${GROUP_ID}/invitations/${ACTIVE_INVITATION.id}`,
      }),
    );
  });
});
