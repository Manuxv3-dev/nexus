/**
 * GroupInvitationsSection — tests unitaires isolés (MAN-193 Phase 2 Tasks
 * 2 & 3). Même stratégie que `GroupMembersPanel.test.tsx` : `@/lib/queries`
 * est mocké au niveau module, pas d'appel réseau réel. Ce fichier couvre le
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  revokedAt: null,
  createdAt: new Date().toISOString(),
};
const REVOKED_INVITATION: InvitationDto = {
  ...ACTIVE_INVITATION,
  id: '33333333-3333-3333-3333-333333333333',
  slug: 'def456',
  revokedAt: new Date().toISOString(),
};

const ADMIN_INVITATION_WITH_LIMITS: InvitationDto = {
  ...ACTIVE_INVITATION,
  id: '44444444-4444-4444-4444-444444444444',
  slug: 'admin789',
  role: 'admin',
  maxUses: 10,
  usedCount: 3,
  expiresAt: '2026-12-31T00:00:00.000Z',
};

const {
  listInvitationsMock,
  revokeMutateMock,
  createMutateMock,
  useRevokeInvitationMock,
  useCreateInvitationMock,
} = vi.hoisted(() => ({
  listInvitationsMock: vi.fn(),
  revokeMutateMock: vi.fn(),
  createMutateMock: vi.fn(),
  useRevokeInvitationMock: vi.fn(),
  useCreateInvitationMock: vi.fn(),
}));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useListInvitations: listInvitationsMock,
    useRevokeInvitation: useRevokeInvitationMock,
    useCreateInvitation: useCreateInvitationMock,
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

function mockRevoke(opts: { isError?: boolean; isPending?: boolean } = {}) {
  useRevokeInvitationMock.mockReturnValue({
    mutate: revokeMutateMock,
    isPending: opts.isPending ?? false,
    isError: opts.isError ?? false,
  });
}

function mockCreate(opts: { isError?: boolean; isPending?: boolean } = {}) {
  useCreateInvitationMock.mockReturnValue({
    mutate: createMutateMock,
    isPending: opts.isPending ?? false,
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
  beforeEach(() => {
    mockRevoke();
    mockCreate();
  });

  afterEach(() => {
    listInvitationsMock.mockReset();
    revokeMutateMock.mockReset();
    createMutateMock.mockReset();
    useRevokeInvitationMock.mockReset();
    useCreateInvitationMock.mockReset();
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

  it('test_shows_role_usage_and_expiry_metadata_for_each_invitation', () => {
    mockList([ADMIN_INVITATION_WITH_LIMITS]);
    renderSection('owner');

    expect(
      screen.getByText('Admin · 3/10 utilisations · expire le 31/12/2026'),
    ).toBeInTheDocument();
  });

  it('test_member_viewer_sees_reserved_message_and_no_invitation_rows', () => {
    // Un viewer `member` n'atteint jamais la branche de rendu de la liste
    // (cf. JSDoc de `GroupInvitationsSection`) : peu importe que la query
    // mockée renvoie des données, le contenu affiché doit être le message
    // "réservé aux admins", jamais une ligne d'invitation ni une affirmation
    // sur l'état de la liste.
    mockList([ACTIVE_INVITATION]);
    renderSection('member');

    expect(screen.getByText('Réservé aux admins du groupe.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Révoquer' })).not.toBeInTheDocument();
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune invitation active pour ce groupe.')).not.toBeInTheDocument();
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

  it('test_create_invitation_disabled_when_viewer_lacks_rank', () => {
    mockList([]);
    renderSection('member');

    const createButton = screen.getByRole('button', { name: 'Créer une invitation' });
    expect(createButton).toBeInTheDocument();
    expect(createButton).toBeDisabled();
  });

  it('test_create_invitation_enabled_for_owner_and_calls_mutate', async () => {
    mockList([]);
    const user = userEvent.setup();
    renderSection('owner');

    const createButton = screen.getByRole('button', { name: 'Créer une invitation' });
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    expect(createMutateMock).toHaveBeenCalledWith({ groupId: GROUP_ID });
  });

  it('test_shows_error_message_when_create_invitation_fails', () => {
    mockList([]);
    mockCreate({ isError: true });
    renderSection('owner');

    expect(screen.getByText("Impossible de créer l'invitation.")).toBeInTheDocument();
  });

  it('test_shows_error_message_when_revoke_invitation_fails', () => {
    mockList([ACTIVE_INVITATION]);
    mockRevoke({ isError: true });
    renderSection('admin');

    expect(screen.getByText("Impossible de révoquer l'invitation.")).toBeInTheDocument();
  });
});
