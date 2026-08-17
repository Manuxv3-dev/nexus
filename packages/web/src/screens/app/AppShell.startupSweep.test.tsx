/**
 * Tranche complète du balayage de démarrage (MAN-239 Phase 3) : shell monté →
 * `useWebviewPartitionSweep` → wrapper `lib/tauri.ts` → `invoke`.
 *
 * `useWebviewPartitionSweep.test.ts` couvre la logique du hook en isolation ;
 * cette suite-ci couvre le **câblage**, qu'un test de hook ne peut pas voir :
 * que le shell passe bien `sessionsQ.isSuccess` (et pas un `sessions.length`
 * ou un `!isLoading`) et les sessions réelles. Ni `lib/tauri.ts` ni
 * `useWebviewPartitionSweep` ne sont mockés ici — seul `invoke` l'est, au
 * niveau du SDK Tauri, comme dans `SettingsScreen.deleteLocalData.test.tsx`.
 *
 * Les deux shells sont couverts : sur desktop, une fenêtre étroite rend
 * `MobileShell` (cf. `ResponsiveAppShell` dans `router.tsx`) et le balayage
 * ne doit pas dépendre de la largeur de fenêtre au démarrage.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import type * as TauriCoreModule from '@tauri-apps/api/core';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const TEST_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

// Piloté par test : simule les états successifs de `useMessagingSessions()`
// (chargement → résolue). Le type est porté par la déclaration plutôt que par
// une assertion — dans un callback `vi.hoisted` sans type de retour déclaré,
// un `as` est signalé inutile par `no-unnecessary-type-assertion`.
const { sessionsQueryRef } = vi.hoisted(() => {
  const sessionsQueryRef: {
    current: { data: QueriesModule.MessagingSession[] | undefined; isSuccess: boolean };
  } = { current: { data: undefined, isSuccess: false } };
  return { sessionsQueryRef };
});

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriCoreModule>();
  return { ...actual, invoke: vi.fn() };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => vi.fn(), useRouterState: () => '' };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => sessionsQueryRef.current,
    useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useHomeFeed: () => ({ data: undefined, isLoading: false, isError: false }),
    useNotifications: () => ({ data: undefined, isLoading: false }),
    useMarkNotificationRead: () => ({ mutate: vi.fn() }),
    useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
    useClearAllNotifications: () => ({ mutate: vi.fn(), isPending: false }),
    useEvents: () => ({ data: [], isLoading: false }),
    usePolls: () => ({ data: [], isLoading: false }),
    useExpenses: () => ({ data: [], isLoading: false }),
    useTodoLists: () => ({ data: [], isLoading: false }),
    useActivityFeed: () => ({ data: [], isLoading: false, isError: false }),
  };
});

import { AppShell } from './AppShell';
import { MobileShell } from './MobileShell';

const mockedInvoke = vi.mocked(invoke);

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function messagingSession(
  providerType: QueriesModule.MessagingSession['providerType'],
  id: string,
): QueriesModule.MessagingSession {
  return {
    id,
    userId: TEST_USER.id,
    providerType,
    externalId: `webview:${TEST_USER.id}`,
    displayName: providerType,
    status: 'connected',
    statusDetail: null,
    lastConnectedAt: null,
    lastError: null,
    createdBy: TEST_USER.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const DISCORD = messagingSession('discord', '44444444-4444-4444-8444-444444444444');
const WHATSAPP = messagingSession('whatsapp', '55555555-5555-4555-8555-555555555555');

function renderShell(Shell: typeof AppShell | typeof MobileShell) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Shell />
    </QueryClientProvider>,
  );
}

/** Appels `invoke` du balayage uniquement — le shell en émet d'autres (webviews). */
function sweepCalls() {
  return mockedInvoke.mock.calls.filter(([cmd]) => cmd === 'sweep_orphaned_webview_partitions');
}

describe.each([
  ['AppShell', AppShell],
  ['MobileShell', MobileShell],
] as const)('%s — balayage des partitions au démarrage', (_name, Shell) => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockResolvedValue({ removed: 0, kept: 0, failed: 0 });
    useAuth.setState({ user: TEST_USER, initializing: false });
    sessionsQueryRef.current = { data: undefined, isSuccess: false };
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    mockedInvoke.mockReset();
    useAuth.setState({ user: null, initializing: true });
  });

  it('ne balaie pas tant que les sessions chargent', () => {
    renderShell(Shell);

    expect(sweepCalls()).toHaveLength(0);
  });

  it('balaie avec les labels des sessions une fois la query résolue', async () => {
    sessionsQueryRef.current = { data: [DISCORD, WHATSAPP], isSuccess: true };

    renderShell(Shell);

    await waitFor(() => expect(sweepCalls()).toHaveLength(1));
    expect(sweepCalls()[0]).toEqual([
      'sweep_orphaned_webview_partitions',
      {
        keepLabels: [`provider:discord:${TEST_USER.id}`, `provider:whatsapp:${TEST_USER.id}`],
      },
    ]);
  });

  it('balaie avec une keep-list vide quand le user n’a aucune session', async () => {
    sessionsQueryRef.current = { data: [], isSuccess: true };

    renderShell(Shell);

    await waitFor(() => expect(sweepCalls()).toHaveLength(1));
    expect(sweepCalls()[0]?.[1]).toEqual({ keepLabels: [] });
  });
});
