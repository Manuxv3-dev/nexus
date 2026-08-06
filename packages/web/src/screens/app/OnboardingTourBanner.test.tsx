/**
 * `OnboardingTourBanner` — surface minimale du tutoriel de découverte
 * (MAN-217 Phase 1 / MAN-220 Task 4).
 *
 * Le VRAI `useOnboardingTour` (dérivé du VRAI store `useAuth`) est utilisé —
 * seule la frontière réseau (`@/lib/api`) est mockée pour les clics
 * Suivant/Passer, même pattern que `onboardingTour.test.ts`.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

import { OnboardingTourBanner } from './OnboardingTourBanner';

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

describe('OnboardingTourBanner', () => {
  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    mockedApi.mockReset();
  });

  it('ne rend rien quand le tutoriel n’a jamais démarré', () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: null });
    render(<OnboardingTourBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('ne rend rien quand le tutoriel est terminé/passé', () => {
    setUser({ onboardingStep: 'invite_link', onboardingCompletedAt: new Date().toISOString() });
    render(<OnboardingTourBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('affiche "Étape 1/5" et le titre de l’étape en cours', () => {
    setUser({ onboardingStep: 'create_group', onboardingCompletedAt: null });
    render(<OnboardingTourBanner />);
    expect(screen.getByText('Étape 1/5')).toBeInTheDocument();
    expect(screen.getByText('Crée ton premier groupe')).toBeInTheDocument();
  });

  it('"Suivant" avance à l’étape suivante via PATCH /auth/me', async () => {
    setUser({ onboardingStep: 'create_group', onboardingCompletedAt: null });
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'invite_link' },
    });
    const user = userEvent.setup();
    render(<OnboardingTourBanner />);

    await user.click(screen.getByRole('button', { name: 'Suivant' }));

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: '/auth/me',
        body: { onboardingStep: 'invite_link' },
      }),
    );
  });

  it('sur la dernière étape, le CTA affiche "Terminer" et pose completedAt', async () => {
    setUser({ onboardingStep: 'public_share', onboardingCompletedAt: null });
    mockedApi.mockResolvedValueOnce({
      user: {
        ...BASE_USER,
        onboardingStep: 'public_share',
        onboardingCompletedAt: new Date().toISOString(),
      },
    });
    const user = userEvent.setup();
    render(<OnboardingTourBanner />);

    const cta = screen.getByRole('button', { name: 'Terminer' });
    await user.click(cta);

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({ body: { onboardingCompleted: true } }),
    );
  });

  it('"Passer" termine le tutoriel via PATCH /auth/me (onboardingCompleted)', async () => {
    setUser({ onboardingStep: 'connect_messaging', onboardingCompletedAt: null });
    mockedApi.mockResolvedValueOnce({
      user: {
        ...BASE_USER,
        onboardingStep: 'connect_messaging',
        onboardingCompletedAt: new Date().toISOString(),
      },
    });
    const user = userEvent.setup();
    render(<OnboardingTourBanner />);

    await user.click(screen.getByRole('button', { name: 'Passer' }));

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({ body: { onboardingCompleted: true } }),
    );
  });

  // MAN-220 revue de code, Fix 5 : un `void f()` nu n'attache aucun handler
  // d'échec — le PATCH raté fait avancer l'étape à l'optimiste puis revenir
  // (rollback de `persistOnboardingPatch`) sans un mot pour l'utilisateur.
  it('"Suivant" affiche un message d’erreur inline si le PATCH échoue, sans planter', async () => {
    setUser({ onboardingStep: 'create_group', onboardingCompletedAt: null });
    mockedApi.mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();
    render(<OnboardingTourBanner />);

    await user.click(screen.getByRole('button', { name: 'Suivant' }));

    expect(await screen.findByText('Action impossible pour le moment. Réessaie.')).toBeVisible();
    // Rollback : l'étape affichée reste la même, pas d'avance fantôme.
    expect(screen.getByText('Étape 1/5')).toBeInTheDocument();
  });

  it('"Passer" affiche un message d’erreur inline si le PATCH échoue', async () => {
    setUser({ onboardingStep: 'create_group', onboardingCompletedAt: null });
    mockedApi.mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();
    render(<OnboardingTourBanner />);

    await user.click(screen.getByRole('button', { name: 'Passer' }));

    expect(await screen.findByText('Action impossible pour le moment. Réessaie.')).toBeVisible();
  });
});
