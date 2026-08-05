/**
 * `useLeaveGroup` — régression MAN-192 (revue de la Phase 1 "Groupes" de
 * Settings). Le endpoint `DELETE /groups/:groupId/members/:userId` sert à
 * DEUX cas d'usage : le self-leave (`GroupMenu.tsx`) et le kick d'un tiers
 * (`RemoveMemberDialog` dans `GroupMembersPanel.tsx`, cf. son propre
 * `onRemoved` local-state). Avant ce correctif, `onSuccess` n'invalidait que
 * `['groups']` — jamais `['group-members', groupId]` — donc un kick laissait
 * ce cache intact : le membre kické réapparaissait après collapse/re-expand
 * de l'accordéon Settings (le state local du panel est remonté à chaque
 * montage, et relit alors le cache non invalidé).
 *
 * Testé directement au niveau du hook (plutôt qu'à travers
 * `GroupMembersPanel`, qui mocke `useLeaveGroup` en bloc dans son propre
 * fichier de test) pour prouver le contenu du cache `queryClient` lui-même,
 * pas seulement un état local de composant — cf. `api` mocké au même niveau
 * que `lib/push.test.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import type * as ApiModule from './api';
import { useAuth } from './auth';
import { useLeaveGroup, type GroupMember } from './queries';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

const GROUP_ID = '11111111-1111-1111-1111-111111111111';
const VIEWER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ID = '33333333-3333-3333-3333-333333333333';

const VIEWER: GroupMember = {
  userId: VIEWER_ID,
  displayName: 'Viewer',
  email: 'viewer@example.com',
  avatarUrl: null,
  role: 'admin',
  joinedAt: new Date().toISOString(),
};
const OTHER: GroupMember = {
  userId: OTHER_ID,
  displayName: 'Other',
  email: 'other@example.com',
  avatarUrl: null,
  role: 'member',
  joinedAt: new Date().toISOString(),
};

function setViewer(userId: string) {
  useAuth.setState({
    user: {
      id: userId,
      email: 'viewer@example.com',
      displayName: 'Viewer',
      avatarUrl: null,
      themePreference: null,
      landingPreference: 'home',
      onboardingStep: null,
      onboardingCompletedAt: null,
      createdAt: new Date().toISOString(),
    },
    initializing: false,
  });
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useLeaveGroup', () => {
  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    mockedApi.mockReset();
  });

  it('test_kick_removes_target_from_group_members_cache', async () => {
    setViewer(VIEWER_ID);
    mockedApi.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData<GroupMember[]>(['group-members', GROUP_ID], [VIEWER, OTHER]);

    const { result } = renderHook(() => useLeaveGroup(), { wrapper: makeWrapper(qc) });
    await result.current.mutateAsync({ groupId: GROUP_ID, userId: OTHER_ID });

    // Le cache `['group-members', groupId]` lui-même (pas un simple état
    // local de composant) ne doit plus contenir la cible kickée : c'est ce
    // que relira un `GroupMembersPanel` remonté (collapse/re-expand de
    // l'accordéon Settings).
    await waitFor(() => {
      const cached = qc.getQueryData<GroupMember[]>(['group-members', GROUP_ID]);
      expect(cached?.map((m) => m.userId)).toEqual([VIEWER_ID]);
    });
  });

  it('test_kick_does_not_invalidate_viewers_own_groups_list', async () => {
    // Un kick ne change rien à la liste de groupes DU VIEWER : invalider
    // `['groups']` dans ce cas serait un aller-retour réseau gratuit.
    setViewer(VIEWER_ID);
    mockedApi.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData<GroupMember[]>(['group-members', GROUP_ID], [VIEWER, OTHER]);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useLeaveGroup(), { wrapper: makeWrapper(qc) });
    await result.current.mutateAsync({ groupId: GROUP_ID, userId: OTHER_ID });

    await waitFor(() => {
      const cached = qc.getQueryData<GroupMember[]>(['group-members', GROUP_ID]);
      expect(cached?.map((m) => m.userId)).toEqual([VIEWER_ID]);
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['groups'] });
  });

  it('test_self_leave_invalidates_viewers_groups_list', async () => {
    setViewer(VIEWER_ID);
    mockedApi.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData<GroupMember[]>(['group-members', GROUP_ID], [VIEWER, OTHER]);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useLeaveGroup(), { wrapper: makeWrapper(qc) });
    await result.current.mutateAsync({ groupId: GROUP_ID, userId: VIEWER_ID });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['groups'] });
    });
  });
});
