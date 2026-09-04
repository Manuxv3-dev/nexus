/**
 * MAN-243 point 5 — le CTA « Crée ton 1er groupe » de la Home desktop est
 * désormais actionnable.
 *
 * C'était une `<section>` non interactive : icône, titre, description, **zéro
 * bouton**. Le code l'appelait « CTA » à trois endroits. Un utilisateur à zéro
 * groupe arrivait sur la Home, lisait une injonction, et n'avait aucune
 * affordance pour l'exécuter — le même cul-de-sac que celui corrigé pour mobile
 * dans MAN-231, resté présent sur desktop.
 *
 * Le second test est le garde-fou qui rend le premier sûr : `QuickActions` fait
 * `groups = groupsQ.data ?? []`, donc `groups.length === 0` était aussi vrai
 * pendant le chargement et après un échec réseau. Tendre un bouton de création
 * dans cet état inviterait un utilisateur qui a déjà des groupes à en créer un
 * en double — précisément le dommage documenté par MAN-231.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { useGroupsMock } = vi.hoisted(() => ({ useGroupsMock: vi.fn() }));

const RESOLVED_EMPTY = { data: [], isPending: false, isError: false, isLoading: false };

/** Feed vide mais **présent** : `HomeContent` (donc `QuickActions`) n'est monté
 *  que si `useHomeFeed().data` est défini. Un `undefined` ne rend rien du tout —
 *  ce n'est pas le cas sous test ici. */
const EMPTY_FEED = {
  upcomingEvents: [],
  weekEvents: [],
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
    useHomeFeed: () => ({
      data: EMPTY_FEED,
      isPending: false,
      isError: false,
      isLoading: false,
    }),
    useEvents: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    usePolls: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    useExpenses: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    useTodoLists: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    useActivityFeed: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { HomeDashboard } from './HomeDashboard';

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

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomeDashboard onNavigate={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('HomeDashboard — CTA de création de groupe (MAN-243)', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
    useGroupsMock.mockReturnValue(RESOLVED_EMPTY);
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    useGroupsMock.mockClear();
  });

  it('offre un bouton de création quand le user n’a réellement aucun groupe', async () => {
    const user = userEvent.setup();
    renderHome();

    // L'injonction existait déjà ; ce qui manquait, c'est l'affordance.
    expect(screen.getByText('Crée ton 1er groupe')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Créer un groupe' });

    // Et le bouton ouvre réellement le formulaire partagé (MAN-200).
    await user.click(button);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('ne propose rien tant que les groupes chargent', () => {
    useGroupsMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isLoading: true,
    });

    renderHome();

    expect(screen.queryByText('Crée ton 1er groupe')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer un groupe' })).not.toBeInTheDocument();
  });

  it('ne propose rien quand la requête a échoué (pas d’invitation au doublon)', () => {
    // Le garde-fou qui compte : sans lui, un utilisateur qui a déjà des groupes
    // mais dont la requête échoue verrait « Crée ton 1er groupe » ET un bouton.
    useGroupsMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isLoading: false,
    });

    renderHome();

    expect(screen.queryByText('Crée ton 1er groupe')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer un groupe' })).not.toBeInTheDocument();
  });
});
