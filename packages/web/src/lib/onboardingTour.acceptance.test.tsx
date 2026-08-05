/**
 * Test d'acceptation du slice "tutoriel de découverte" (MAN-217 Phase 1 /
 * MAN-220 Task 5).
 *
 * Mirror du pattern de `GroupsSection.invitations.integration.test.tsx` :
 * seule la frontière réseau (`@/lib/api`) est mockée, tout le reste — le VRAI
 * store `useAuth`, la VRAIE state machine (`@/lib/onboardingTour`), le VRAI
 * `OnboardingTourBanner` et le VRAI contrôle de replay des Réglages
 * (`ReplayOnboardingTourRow`, exporté de `SettingsScreen.tsx` pour cette
 * raison) — est monté tel quel.
 *
 * `useNavigate` de `@tanstack/react-router` est mocké : `ReplayOnboardingTourRow`
 * l'utilise pour renvoyer vers `/app` après un replay réussi, mais ce test
 * n'a pas de vrai router monté (hors sujet ici — Task 5 porte sur la state
 * machine + la surface, pas sur la navigation inter-écrans).
 *
 * Parcours couvert (scénario du ticket) :
 *   nouveau compte → tuto visible à l'étape 1 → avance → **unmount**
 *   (simule une interruption : fermeture d'onglet) → **remount** → reprend à
 *   la MÊME étape → passe → n'apparaît plus → relance depuis les Réglages →
 *   visible de nouveau à l'étape 1.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => navigateMock };
});

// Montés APRÈS les mocks ci-dessus, comme le veut vitest pour que les modules
// important `@/lib/api`/`@tanstack/react-router` reçoivent la version mockée.
// Imports relatifs (pas `@/...`) : même astuce que
// `GroupsSection.invitations.integration.test.tsx` pour que `import/order`
// les classe dans un groupe distinct du bloc `@/lib/...` du haut, plutôt que
// de signaler une ligne vide "au milieu" du même groupe `internal`.
import { OnboardingTourBanner } from '../screens/app/OnboardingTourBanner';
import { ReplayOnboardingTourRow } from '../screens/settings/SettingsScreen';

import { useOnboardingTourAutoStart } from './onboardingTour';

const mockedApi = vi.mocked(api);

const BASE_USER: User = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'moi@example.com',
  displayName: 'Moi',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home',
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

function setUser(patch: Partial<User> = {}) {
  useAuth.setState({ user: { ...BASE_USER, ...patch }, initializing: false });
}

/**
 * Harnais minimal représentant "l'app authentifiée" : le trigger racine
 * (normalement monté une fois dans `RootComponent` de `router.tsx`) + la
 * surface visible (normalement montée dans `AppShell`/`MobileShell`). Une
 * `QueryClientProvider` est nécessaire car `ReplayOnboardingTourRow` (rendu
 * séparément ci-dessous, dans le même arbre) vit normalement sous
 * `SettingsScreen`, qui dépend de React Query ailleurs dans le fichier —
 * absent ici, mais le provider reste inoffensif à poser une fois pour tout
 * le test.
 */
function AppSurface() {
  useOnboardingTourAutoStart();
  return <OnboardingTourBanner />;
}

/**
 * Simule les deux zones de l'app réelle (shell + Réglages) dans un seul
 * arbre : le store `useAuth` est global (zustand), donc une action posée
 * depuis le contrôle "Réglages" se répercute immédiatement sur la surface
 * "shell" sans navigation réelle à simuler — exactement ce que Task 5 doit
 * prouver (l'intégration bout-en-bout de la state machine, pas le routing).
 */
function renderHarness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppSurface />
      <ReplayOnboardingTourRow />
    </QueryClientProvider>,
  );
}

describe('Acceptation — tutoriel de découverte (MAN-217 Phase 1 / MAN-220 Task 5)', () => {
  beforeEach(() => {
    mockedApi.mockReset();
    navigateMock.mockReset();
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  it('nouveau compte → visible étape 1 → avance → interruption (unmount/remount) → reprend → passe → relance', async () => {
    const user = userEvent.setup();

    // ─── 1. Nouveau compte : les deux champs sont null. ────────────────────
    setUser({ onboardingStep: null, onboardingCompletedAt: null });

    // Le trigger (`useOnboardingTourAutoStart`) démarre le tuto au montage.
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'create_group' },
    });
    const { unmount } = renderHarness();

    expect(await screen.findByText('Étape 1/5')).toBeInTheDocument();
    expect(screen.getByText('Crée ton premier groupe')).toBeInTheDocument();

    // ─── 2. Avance d'une étape. ─────────────────────────────────────────────
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'invite_link' },
    });
    await user.click(screen.getByRole('button', { name: 'Suivant' }));

    expect(await screen.findByText('Étape 2/5')).toBeInTheDocument();
    expect(screen.getByText('Invite ta bande')).toBeInTheDocument();

    // ─── 3. Interruption : l'utilisateur ferme l'onglet (unmount). ─────────
    unmount();

    // ─── 4. Retour plus tard : remonte la surface, sans nouvel appel réseau
    //        (le trigger ne redémarre PAS un tuto déjà en cours). ───────────
    renderHarness();

    expect(await screen.findByText('Étape 2/5')).toBeInTheDocument();
    expect(screen.getByText('Invite ta bande')).toBeInTheDocument();
    // Un seul PATCH depuis le début du test : celui du `start()` initial et
    // celui du `next()` — aucun appel supplémentaire au remount.
    expect(mockedApi).toHaveBeenCalledTimes(2);

    // ─── 5. Passe le tutoriel : ne réapparaît plus. ─────────────────────────
    mockedApi.mockResolvedValueOnce({
      user: {
        ...BASE_USER,
        onboardingStep: 'invite_link',
        onboardingCompletedAt: new Date().toISOString(),
      },
    });
    await user.click(screen.getByRole('button', { name: 'Passer' }));

    await waitFor(() => expect(screen.queryByText(/^Étape /)).not.toBeInTheDocument());

    // ─── 6. Relance depuis les Réglages : visible de nouveau à l'étape 1. ──
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'create_group', onboardingCompletedAt: null },
    });
    await user.click(screen.getByText('Relancer le tutoriel'));

    expect(await screen.findByText('Étape 1/5')).toBeInTheDocument();
    expect(screen.getByText('Crée ton premier groupe')).toBeInTheDocument();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app' }));
  });
});
