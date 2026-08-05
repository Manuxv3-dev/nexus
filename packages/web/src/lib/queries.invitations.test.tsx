/**
 * `useListInvitations`/`useRevokeInvitation` — MAN-193 Phase 2 Task 1.
 *
 * Même stratégie que `queries.leaveGroup.test.tsx` : `api` est mocké au
 * niveau module (pas d'appel réseau réel), le comportement est vérifié
 * directement contre un vrai `QueryClient` (cache réel), pas seulement des
 * assertions sur des mocks de fonction.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import type * as ApiModule from './api';
import type { InvitationDto } from './queries';
import { useListInvitations, useRevokeInvitation } from './queries';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

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

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useListInvitations', () => {
  afterEach(() => {
    mockedApi.mockReset();
  });

  it('test_useListInvitations_disabled_for_member_role', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useListInvitations(GROUP_ID, false), { wrapper: makeWrapper(qc) });

    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('test_useListInvitations_fetches_for_admin_or_owner', async () => {
    mockedApi.mockResolvedValue({ invitations: [ACTIVE_INVITATION] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useListInvitations(GROUP_ID, true), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([ACTIVE_INVITATION]);
    });
    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: `/groups/${GROUP_ID}/invitations` }),
    );
  });
});

describe('useRevokeInvitation', () => {
  afterEach(() => {
    mockedApi.mockReset();
  });

  it('test_useRevokeInvitation_invalidates_list_on_success', async () => {
    mockedApi.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['invitations', GROUP_ID], [ACTIVE_INVITATION]);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useRevokeInvitation(), { wrapper: makeWrapper(qc) });
    await result.current.mutateAsync({ groupId: GROUP_ID, invitationId: ACTIVE_INVITATION.id });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['invitations', GROUP_ID] });
    });
  });
});
