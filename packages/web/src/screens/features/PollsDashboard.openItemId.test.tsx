/**
 * Deep-link vers un sondage précis (Cortex f170f4d8).
 *
 * `PollsDashboard` était le seul des 4 dashboards orga à ne pas recevoir
 * `openItemId` : `AppShell`/`MobileShell` ne le lui câblaient pas, et le
 * composant n'exposait même pas la prop. `notificationKindToPane`
 * (`packages/shared/src/notifications.ts`) n'a aucun `NotificationKind` qui
 * mappe vers `'poll'` — la cloche de notifs ne produit donc jamais ce
 * deep-link. Les producteurs réellement affectés : `HomeDashboard`,
 * `GroupHomeDashboard`, `ActivityTimeline` (navigation in-app directe vers un
 * sondage) et l'URL de deep-link push (`?pane=poll&sourceId=…`) — tous
 * amenaient sur la liste des sondages sans jamais ouvrir l'item visé.
 *
 * Ce fichier couvre le contrat du composant, pas le câblage shell (déjà
 * couvert côté `AppShell.pushDeepLink.test.tsx`) : `openItemId` ⇒ modale
 * ouverte sur le bon sondage + intention consommée une seule fois. Même
 * mock minimal que `EventsDashboard.pastInCalendar.test.tsx` plutôt que le
 * mock complet de `dashboards-acceptance.test.tsx` — ce test ne porte que sur
 * `usePolls`/`useGroups`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    useGroupMembers: () => ({ data: [], isPending: false, isError: false }),
    usePolls: (_groupId: string | undefined, filter: { state?: string }) => ({
      data: filter.state === 'closed' ? [CLOSED_POLL] : [OPEN_POLL],
      isPending: false,
      isError: false,
      isLoading: false,
    }),
  };
});

import { PollsDashboard } from './PollsDashboard';
import { buildPoll, GROUP_ID } from './testFixtures';

const OPEN_POLL = buildPoll({ id: 'poll-open', question: 'Pizza ou sushi ?' });
const CLOSED_POLL = buildPoll({
  id: 'poll-closed',
  question: 'Plage ou montagne ?',
  closesAt: new Date(Date.now() - 3_600_000).toISOString(),
});

const TEST_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

function renderDashboard(props: Partial<Parameters<typeof PollsDashboard>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <PollsDashboard groupId={GROUP_ID} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe('PollsDashboard — deep-link openItemId (Cortex f170f4d8)', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  it('ouvre la modale du sondage visé par openItemId, y compris parmi les sondages clos', () => {
    const onConsumeOpen = vi.fn();
    renderDashboard({ openItemId: CLOSED_POLL.id, onConsumeOpen });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(CLOSED_POLL.question);
    expect(onConsumeOpen).toHaveBeenCalledTimes(1);
  });

  it('ne rouvre pas et ne reconsomme pas quand openItemId retombe à null (parent a déjà consommé)', () => {
    const onConsumeOpen = vi.fn();
    const { rerender, qc } = renderDashboard({ openItemId: OPEN_POLL.id, onConsumeOpen });

    expect(screen.getByRole('dialog')).toHaveTextContent(OPEN_POLL.question);
    expect(onConsumeOpen).toHaveBeenCalledTimes(1);

    // Même `QueryClient` que le rendu initial : un second provider créerait un
    // état hybride (deux caches TanStack Query pour un seul arbre monté), pas
    // ce que fait réellement `AppShell`/`MobileShell` quand `pendingOpen`
    // retombe à `null` après consommation (le shell ne redémonte rien).
    rerender(
      <QueryClientProvider client={qc}>
        <PollsDashboard groupId={GROUP_ID} openItemId={null} onConsumeOpen={onConsumeOpen} />
      </QueryClientProvider>,
    );

    // La modale reste montrée (fermeture au clic sur Fermer, pas automatique),
    // mais `onConsumeOpen` n'est pas rappelé pour un `openItemId` déjà nul.
    expect(screen.getByRole('dialog')).toHaveTextContent(OPEN_POLL.question);
    expect(onConsumeOpen).toHaveBeenCalledTimes(1);
  });
});
