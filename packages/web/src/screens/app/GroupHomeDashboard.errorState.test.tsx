/**
 * MAN-244 — les 4 KPI des HeroCards n'inventent plus de compte sur échec.
 *
 * Cas le plus dommageable des huit relevés par le ticket : ces KPI ne se
 * contentaient pas d'affirmer le vide, ils **orientaient l'action**. En échec,
 * `isLoading ? '…' : String(count)` affichait `0`, et le `ctaLabel` basculait sur
 * « Créer un événement » / « Lancer un sondage » / « Créer une liste » —
 * poussant l'utilisateur à recréer ce qui existe peut-être déjà.
 *
 * Le KPI Dépenses était le pire : `formatMoney(0)` avec l'unité « tout est
 * réglé », soit l'affirmation qu'on ne doit rien, sur la base d'aucune donnée.
 *
 * Les deux moitiés de chaque assertion comptent : la valeur passe à `—`, **et**
 * le CTA ne propose pas la création. Vérifier seulement la première laisserait
 * passer l'incitation trompeuse.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { useEventsMock, usePollsMock, useExpensesMock, useTodoListsMock } = vi.hoisted(() => ({
  useEventsMock: vi.fn(),
  usePollsMock: vi.fn(),
  useExpensesMock: vi.fn(),
  useTodoListsMock: vi.fn(),
}));

/** Défaut sain : `mockClear` (et non `mockReset`) en teardown, sinon le composant
 *  jette sur `.data` au re-render de nettoyage — 553 tests verts et vitest en
 *  exit 1, piège rencontré sur la PR précédente de ce ticket. */
const OK = { data: [], isPending: false, isError: false, isLoading: false };
const FAILED = { data: undefined, isPending: false, isError: true, isLoading: false };

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useEvents: useEventsMock,
    usePolls: usePollsMock,
    useExpenses: useExpensesMock,
    useTodoLists: useTodoListsMock,
    useActivityFeed: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    useGroupMembers: () => ({ data: [], isPending: false, isError: false }),
  };
});

import { GroupHomeDashboard } from './GroupHomeDashboard';

const TEST_GROUP: QueriesModule.Group = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'La Bande du 11e',
  createdBy: '11111111-1111-4111-8111-111111111111',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

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

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupHomeDashboard group={TEST_GROUP} onNavigate={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('GroupHomeDashboard — KPI sur échec (MAN-244)', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
    useEventsMock.mockReturnValue(OK);
    usePollsMock.mockReturnValue(OK);
    useExpensesMock.mockReturnValue(OK);
    useTodoListsMock.mockReturnValue(OK);
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    useEventsMock.mockClear();
    usePollsMock.mockClear();
    useExpensesMock.mockClear();
    useTodoListsMock.mockClear();
  });

  it('événements : affiche — et ne propose pas la création quand la query échoue', () => {
    useEventsMock.mockReturnValue(FAILED);

    renderDashboard();

    expect(screen.getByText('indisponible')).toBeInTheDocument();
    // L'incitation trompeuse ne doit plus apparaître.
    expect(screen.queryByText('Créer un événement')).not.toBeInTheDocument();
    expect(screen.getByText("Voir l'agenda")).toBeInTheDocument();
  });

  it('sondages : ne propose pas « Lancer un sondage » quand la query échoue', () => {
    usePollsMock.mockReturnValue(FAILED);

    renderDashboard();

    expect(screen.queryByText('Lancer un sondage')).not.toBeInTheDocument();
    expect(screen.getByText('Voir les sondages')).toBeInTheDocument();
  });

  it('tâches : ne propose pas « Créer une liste » quand la query échoue', () => {
    useTodoListsMock.mockReturnValue(FAILED);

    renderDashboard();

    expect(screen.queryByText('Créer une liste')).not.toBeInTheDocument();
    expect(screen.getByText('Voir mes tâches')).toBeInTheDocument();
  });

  it('dépenses : n’affirme plus « tout est réglé » avec un solde à zéro sur échec', () => {
    // Le pire des quatre : avant, un échec réseau affichait un solde de 0 € et
    // l'unité « tout est réglé » — l'app disait à l'utilisateur qu'il ne devait
    // rien alors qu'elle n'avait aucune donnée.
    useExpensesMock.mockReturnValue(FAILED);

    renderDashboard();

    expect(screen.queryByText('tout est réglé')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajouter une dépense')).not.toBeInTheDocument();
    expect(screen.getByText('Voir les soldes')).toBeInTheDocument();
  });

  it('affiche les compteurs normalement quand tout va bien', () => {
    renderDashboard();

    // Aucun KPI en état indisponible, et les CTA de création reviennent puisque
    // les listes sont réellement vides.
    expect(screen.queryByText('indisponible')).not.toBeInTheDocument();
    expect(screen.getByText('Créer un événement')).toBeInTheDocument();
  });
});
