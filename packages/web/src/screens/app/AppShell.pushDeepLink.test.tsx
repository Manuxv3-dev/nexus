/**
 * AppShell — deep-link push (MAN-143 Phase 2 Task 4).
 *
 * Fichier séparé de `AppShell.test.tsx` : ce scénario a besoin d'un mock
 * dédié de `EventsDashboard` (pour observer les props `groupId`/`openItemId`
 * sans avoir à mocker toute la pile de queries qu'il consomme en interne —
 * `useEvent`, `useGroupMembers`, etc.), ce qui rendrait le fichier de tests
 * partagé plus difficile à suivre pour les autres suites.
 *
 * On pilote l'URL via `window.history.pushState` avant le montage — comme
 * `readPushDeepLinkParams` (AppShell.tsx) lit `window.location.search`
 * directement, sans dépendre du router (même convention que
 * `OAuthCallbackScreen`/`RegisterScreen`, cf. leurs usages de
 * `new URLSearchParams(window.location.search)`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { navigateMock, groupsRef, eventsDashboardPropsRef } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  groupsRef: { current: [] as QueriesModule.Group[] },
  eventsDashboardPropsRef: {
    current: null as { groupId?: string; openItemId?: string | null } | null,
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: groupsRef.current, isLoading: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => ({ data: [] }),
    useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useHomeFeed: () => ({ data: undefined, isLoading: false, isError: false }),
    useNotifications: () => ({ data: undefined, isLoading: false }),
    useMarkNotificationRead: () => ({ mutate: vi.fn() }),
    useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
    useClearAllNotifications: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock('../features/EventsDashboard', () => ({
  EventsDashboard: (props: { groupId?: string; openItemId?: string | null }) => {
    eventsDashboardPropsRef.current = props;
    return null;
  },
}));

import { AppShell } from './AppShell';

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>,
  );
}

const TEST_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  createdAt: new Date().toISOString(),
};

const GROUP_A: QueriesModule.Group = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'La Bande du 11e',
  createdBy: TEST_USER.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

describe('AppShell — deep-link push (MAN-143 Phase 2 Task 4)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    eventsDashboardPropsRef.current = null;
    groupsRef.current = [GROUP_A];
    useAuth.setState({ user: TEST_USER, initializing: false });
    window.history.pushState({}, '', '/app');
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    window.history.pushState({}, '', '/app');
  });

  it('ouvre l’item cible depuis ?groupId&pane&sourceId au montage puis nettoie l’URL', async () => {
    window.history.pushState({}, '', `/app?groupId=${GROUP_A.id}&pane=event&sourceId=evt-1`);

    renderShell();

    await waitFor(() => {
      expect(eventsDashboardPropsRef.current).not.toBeNull();
    });
    // Même mécanisme `pendingOpen` que le clic sur une notif in-app
    // (NotificationsBell/HomeDashboard) : le dashboard reçoit le groupe et
    // l'item ciblés, prêt à consommer via `onConsumeOpen`.
    expect(eventsDashboardPropsRef.current).toMatchObject({
      groupId: GROUP_A.id,
      openItemId: 'evt-1',
    });
    // L'URL est nettoyée pour ne pas rejouer le deep-link à un refresh.
    expect(navigateMock).toHaveBeenCalledWith({ to: '/app', search: {}, replace: true });
  });

  it('ignore des query params sans groupId et suit le flux normal (pref landing)', () => {
    window.history.pushState({}, '', '/app?pane=event');

    renderShell();

    expect(eventsDashboardPropsRef.current).toBeNull();
    expect(navigateMock).not.toHaveBeenCalledWith({ to: '/app', search: {}, replace: true });
  });
});
