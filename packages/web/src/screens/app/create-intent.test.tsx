/**
 * MAN-246 point 1 — les 8 CTA « Créer X » créent réellement.
 *
 * Huit boutons annonçaient une création et ne faisaient que changer de pane.
 * Sur les 4 HeroCards de `GroupHomeDashboard`, la seule différence entre
 * « Créer un événement » et « Voir l'agenda » était le **libellé** : les deux
 * branches du ternaire appelaient le même `onOpen()`.
 *
 * Ce fichier couvre la tranche entière, des émetteurs (`screens/app`) aux
 * consommateurs (`screens/features`) — c'est le canal qui compte, pas chaque
 * moitié prise isolément : un intent émis que personne ne consomme, ou un
 * dashboard qui sait ouvrir sans que personne le lui demande, ne livre rien.
 *
 * Le garde-fou MAN-244 est retesté ici sous un autre angle : un KPI en erreur
 * ne doit émettre **aucun** intent de création. `GroupHomeDashboard.errorState.test.tsx`
 * vérifie que le libellé ne bascule pas ; ici on vérifie que la cible de
 * navigation ne porte pas l'intention non plus.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';
import { EventsDashboard } from '@/screens/features/EventsDashboard';
import { ExpensesDashboard } from '@/screens/features/ExpensesDashboard';
import { PollsDashboard } from '@/screens/features/PollsDashboard';
import { TodosDashboard } from '@/screens/features/TodosDashboard';

import { GroupHomeDashboard } from './GroupHomeDashboard';
import { HomeDashboard } from './HomeDashboard';

const { useGroupsMock, useEventsMock, usePollsMock, useExpensesMock, useTodoListsMock } =
  vi.hoisted(() => ({
    useGroupsMock: vi.fn(),
    useEventsMock: vi.fn(),
    usePollsMock: vi.fn(),
    useExpensesMock: vi.fn(),
    useTodoListsMock: vi.fn(),
  }));

const OK = { data: [], isPending: false, isError: false, isLoading: false };
const FAILED = { data: undefined, isPending: false, isError: true, isLoading: false };

const TEST_GROUP: QueriesModule.Group = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'La Bande du 11e',
  createdBy: '11111111-1111-4111-8111-111111111111',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

const GROUPS_OK = { data: [TEST_GROUP], isPending: false, isError: false, isLoading: false };

/** `HomeContent` (donc `QuickActions`) n'est monté que si le feed est défini. */
const EMPTY_FEED = {
  upcomingEvents: [],
  pendingRsvps: [],
  pendingPolls: [],
  unsettledExpenses: [],
  assignedTodos: [],
  unreadByGroup: [],
};

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: useGroupsMock,
    useEvents: useEventsMock,
    usePolls: usePollsMock,
    useExpenses: useExpensesMock,
    useTodoLists: useTodoListsMock,
    useEvent: () => ({ data: undefined }),
    useActivityFeed: () => OK,
    useGroupMembers: () => ({ data: [], isPending: false, isError: false }),
    useHomeFeed: () => ({ data: EMPTY_FEED, isPending: false, isError: false, isLoading: false }),
  };
});

const TEST_USER = {
  id: TEST_GROUP.createdBy,
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useAuth.setState({ user: TEST_USER, initializing: false });
  useGroupsMock.mockReturnValue(GROUPS_OK);
  useEventsMock.mockReturnValue(OK);
  usePollsMock.mockReturnValue(OK);
  useExpensesMock.mockReturnValue(OK);
  useTodoListsMock.mockReturnValue(OK);
  window.localStorage.clear();
});

afterEach(() => {
  useAuth.setState({ user: null, initializing: true });
  // `mockClear` et non `mockReset` : le re-render de nettoyage lirait `.data`
  // sur `undefined` (piège documenté dans GroupHomeDashboard.errorState.test.tsx).
  useGroupsMock.mockClear();
  useEventsMock.mockClear();
  usePollsMock.mockClear();
  useExpensesMock.mockClear();
  useTodoListsMock.mockClear();
});

describe('GroupHomeDashboard — les HeroCards vides émettent une intention de création (MAN-246)', () => {
  const CASES = [
    { cta: 'Créer un événement', pane: 'event' },
    { cta: 'Lancer un sondage', pane: 'poll' },
    { cta: 'Ajouter une dépense', pane: 'expense' },
    { cta: 'Créer une liste', pane: 'todo' },
  ] as const;

  for (const { cta, pane } of CASES) {
    it(`« ${cta} » émet la pane ${pane} avec l'intention de créer`, async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();
      withClient(<GroupHomeDashboard group={TEST_GROUP} onNavigate={onNavigate} />);

      await user.click(screen.getByText(cta));

      expect(onNavigate).toHaveBeenCalledWith({ pane, create: true });
    });
  }

  it('un CTA de consultation reste de la navigation pure', async () => {
    useEventsMock.mockReturnValue({
      ...OK,
      data: [
        {
          id: 'evt-1',
          groupId: TEST_GROUP.id,
          slug: 'evt-1',
          tags: [],
          title: 'Apéro',
          description: null,
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          location: null,
          createdBy: TEST_USER.id,
          rsvps: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    withClient(<GroupHomeDashboard group={TEST_GROUP} onNavigate={onNavigate} />);

    await user.click(screen.getByText("Voir l'agenda"));

    expect(onNavigate).toHaveBeenCalledWith({ pane: 'event' });
  });

  it("n'émet aucune intention de création quand le KPI est en erreur (garde-fou MAN-244)", async () => {
    // Le compte est inconnu, pas nul : pousser à créer risquerait un doublon.
    useEventsMock.mockReturnValue(FAILED);
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    withClient(<GroupHomeDashboard group={TEST_GROUP} onNavigate={onNavigate} />);

    await user.click(screen.getByText("Voir l'agenda"));

    expect(onNavigate).toHaveBeenCalledWith({ pane: 'event' });
  });
});

describe('HomeDashboard — les 4 QuickActions créent réellement (MAN-246)', () => {
  const CASES = [
    { label: 'Nouvel event', pane: 'event' },
    { label: 'Nouveau sondage', pane: 'poll' },
    { label: 'Nouvelle dépense', pane: 'expense' },
    { label: 'Nouvelle todo', pane: 'todo' },
  ] as const;

  for (const { label, pane } of CASES) {
    it(`« ${label} » cible le groupe actif avec l'intention de créer`, async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();
      withClient(<HomeDashboard onNavigate={onNavigate} />);

      await user.click(screen.getByText(label));

      expect(onNavigate).toHaveBeenCalledWith({
        groupId: TEST_GROUP.id,
        pane,
        create: true,
      });
    });
  }
});

describe('Les 4 dashboards consomment l’intention de création (MAN-246)', () => {
  const CASES = [
    {
      name: 'EventsDashboard',
      render: (p: DashProps) => (
        <EventsDashboard
          groupId={p.groupId}
          openCreate={p.openCreate}
          onConsumeOpen={p.onConsumeOpen}
        />
      ),
    },
    {
      name: 'PollsDashboard',
      render: (p: DashProps) => (
        <PollsDashboard
          groupId={p.groupId}
          openCreate={p.openCreate}
          onConsumeOpen={p.onConsumeOpen}
        />
      ),
    },
    {
      name: 'ExpensesDashboard',
      render: (p: DashProps) => (
        <ExpensesDashboard
          groupId={p.groupId}
          openCreate={p.openCreate}
          onConsumeOpen={p.onConsumeOpen}
        />
      ),
    },
    {
      name: 'TodosDashboard',
      render: (p: DashProps) => (
        <TodosDashboard
          groupId={p.groupId}
          openCreate={p.openCreate}
          onConsumeOpen={p.onConsumeOpen}
        />
      ),
    },
  ];

  interface DashProps {
    groupId: string;
    openCreate: boolean;
    onConsumeOpen: () => void;
  }

  for (const { name, render: renderDash } of CASES) {
    it(`${name} ouvre la modale de création et consomme l'intention`, async () => {
      const onConsumeOpen = vi.fn();
      withClient(renderDash({ groupId: TEST_GROUP.id, openCreate: true, onConsumeOpen }));

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      // Consommée une seule fois : sans ça, la modale se rouvrirait à chaque
      // re-render tant que le shell n'a pas remis `pendingOpen` à null.
      await waitFor(() => expect(onConsumeOpen).toHaveBeenCalledTimes(1));
    });

    it(`${name} n'ouvre rien sans intention`, () => {
      const onConsumeOpen = vi.fn();
      withClient(renderDash({ groupId: TEST_GROUP.id, openCreate: false, onConsumeOpen }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onConsumeOpen).not.toHaveBeenCalled();
    });
  }
});
