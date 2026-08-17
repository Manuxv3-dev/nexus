/**
 * MAN-244 — un échec de requête ne doit jamais produire un état vide.
 *
 * Avant le correctif, la chaîne était `!activeGroupId → isLoading → contenu` :
 * pas de branche `isError`. Une requête en échec laisse `data` à `undefined`,
 * `upcoming` vaut donc `[]`, et le dashboard affirmait sereinement « Pas encore
 * d'événements ». Sur mobile — réseau instable, token expiré — c'est le cas
 * courant, pas le cas limite.
 *
 * Ce test monte le dashboard avec une query en échec et vérifie les deux moitiés
 * de l'affirmation : le message d'erreur apparaît, **et** l'état vide n'apparaît
 * pas. Vérifier seulement la première laisserait passer une UI qui affiche les
 * deux.
 *
 * `EventsDashboard` accepte `groupId` en prop (fallback `groups[0]?.id`), ce qui
 * permet de le monter sans contexte `AppShell`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { useEventsMock } = vi.hoisted(() => ({ useEventsMock: vi.fn() }));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
    useGroupMembers: () => ({ data: [], isPending: false, isError: false }),
    useEvent: () => ({ data: undefined, isPending: false, isError: false }),
    useEvents: useEventsMock,
  };
});

import { EventsDashboard } from './EventsDashboard';

const GROUP_ID = '22222222-2222-4222-8222-222222222222';

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
      <EventsDashboard groupId={GROUP_ID} />
    </QueryClientProvider>,
  );
}

describe('EventsDashboard — états asynchrones (MAN-244)', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
    // Défaut sain, écrasé par chaque test. Indispensable : `useEvents` est
    // appelé deux fois par render (upcoming + past) et le composant lit
    // `.data` immédiatement. Un mock sans valeur de retour renvoie `undefined`
    // et fait jeter le composant au re-render de nettoyage de Testing Library
    // — ce qui produit des « unhandled errors » et un exit non-nul de vitest
    // *alors que toutes les assertions passent*. D'où `mockClear` (efface les
    // appels) et non `mockReset` (efface aussi l'implémentation) en `afterEach`.
    useEventsMock.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    useEventsMock.mockClear();
  });

  it("affiche une erreur, et surtout PAS l'état vide, quand la requête échoue", () => {
    useEventsMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isLoading: false,
    });

    renderDashboard();

    expect(screen.getByText('Impossible de charger les événements.')).toBeInTheDocument();
    // La moitié qui compte : l'UI ne doit plus affirmer le vide.
    expect(screen.queryByText(/Pas encore d'événements/i)).not.toBeInTheDocument();
  });

  it('affiche le chargement quand la query est en attente', () => {
    useEventsMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isLoading: true,
    });

    renderDashboard();

    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(screen.queryByText('Impossible de charger les événements.')).not.toBeInTheDocument();
  });

  it('affiche le chargement quand la query est désactivée (isPending sans isLoading)', () => {
    // Le piège de MAN-231 : en TanStack v5 une query désactivée via `enabled`
    // rapporte `isLoading === false` avec `isPending === true`. Avec l'ancien
    // `isLoading`, cette combinaison tombait dans la branche contenu et
    // affichait l'état vide pendant toute la fenêtre d'activation.
    useEventsMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isLoading: false,
    });

    renderDashboard();

    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(screen.queryByText(/Pas encore d'événements/i)).not.toBeInTheDocument();
  });
});
