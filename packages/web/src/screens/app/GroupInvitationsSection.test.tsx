/**
 * GroupInvitationsSection — tests unitaires isolés (MAN-193 Phase 2 Task 2).
 * Même stratégie que `GroupMembersPanel.test.tsx` : `@/lib/queries` est
 * mocké au niveau module, pas d'appel réseau réel. Ce fichier couvre le
 * comportement d'AFFICHAGE et les états `disabled` — le comportement réel
 * de gating (`enabled` passé au hook selon le rôle) et les mises à jour de
 * cache après mutation sont couverts séparément dans
 * `GroupInvitationsSection.integration.test.tsx`, qui utilise les VRAIS
 * hooks avec `api` mocké au plus bas niveau (même split que
 * `GroupsSection.test.tsx`/`GroupsSection.integration.test.tsx`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GroupMember, InvitationDto } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

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
const REVOKED_INVITATION: InvitationDto = {
  ...ACTIVE_INVITATION,
  id: '33333333-3333-3333-3333-333333333333',
  slug: 'def456',
  revokedAt: new Date().toISOString(),
};

const { listInvitationsMock, revokeMutateMock } = vi.hoisted(() => ({
  listInvitationsMock: vi.fn(),
  revokeMutateMock: vi.fn(),
}));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useListInvitations: listInvitationsMock,
    useRevokeInvitation: () => ({ mutate: revokeMutateMock, isPending: false }),
  };
});

import { GroupInvitationsSection } from './GroupInvitationsSection';

function mockList(
  data: InvitationDto[] | undefined,
  opts: { isLoading?: boolean; isError?: boolean } = {},
) {
  listInvitationsMock.mockReturnValue({
    data,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
  });
}

function renderSection(viewerRole: GroupMember['role'] | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupInvitationsSection groupId={GROUP_ID} viewerRole={viewerRole} />
    </QueryClientProvider>,
  );
}

describe('GroupInvitationsSection', () => {
  afterEach(() => {
    listInvitationsMock.mockReset();
    revokeMutateMock.mockReset();
  });

  it('test_shows_empty_state_when_no_active_invitations', () => {
    mockList([]);
    renderSection('admin');
    expect(screen.getByText('Aucune invitation active pour ce groupe.')).toBeInTheDocument();
  });

  it('test_shows_empty_state_when_all_invitations_revoked', () => {
    mockList([REVOKED_INVITATION]);
    renderSection('owner');
    expect(screen.getByText('Aucune invitation active pour ce groupe.')).toBeInTheDocument();
    expect(screen.queryByText(/def456/)).not.toBeInTheDocument();
  });

  it('test_lists_active_invitations_with_copyable_link', async () => {
    mockList([ACTIVE_INVITATION]);
    const user = userEvent.setup();
    renderSection('admin');

    const expectedLink = `${window.location.origin}/invite/${ACTIVE_INVITATION.slug}`;
    expect(screen.getByText(expectedLink)).toBeInTheDocument();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await user.click(screen.getByRole('button', { name: 'Copier' }));

    expect(writeText).toHaveBeenCalledWith(expectedLink);
    expect(await screen.findByRole('button', { name: 'Copié !' })).toBeInTheDocument();
  });

  it('test_revoke_button_disabled_when_viewer_lacks_rank', () => {
    mockList([ACTIVE_INVITATION]);
    renderSection('member');

    const revokeButton = screen.getByRole('button', { name: 'Révoquer' });
    expect(revokeButton).toBeInTheDocument();
    expect(revokeButton).toBeDisabled();
  });

  it('test_revoke_button_enabled_for_admin_and_calls_mutate', async () => {
    mockList([ACTIVE_INVITATION]);
    const user = userEvent.setup();
    renderSection('admin');

    const revokeButton = screen.getByRole('button', { name: 'Révoquer' });
    expect(revokeButton).toBeEnabled();
    await user.click(revokeButton);

    expect(revokeMutateMock).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      invitationId: ACTIVE_INVITATION.id,
    });
  });
});
