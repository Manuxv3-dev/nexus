/**
 * `lib/onboardingTour.ts` — state machine du tutoriel de découverte
 * (MAN-217 Phase 1 / MAN-220, Task 3).
 *
 * Deux familles de tests :
 *  - `deriveOnboardingTourState` : fonction pure, testée sur les 4
 *    combinaisons des deux champs persistés (aucun mock nécessaire).
 *  - transitions (`start`/`next`/`skip`/`finish`/`replay`) : `@/lib/api` est
 *    mocké à la frontière réseau (même pattern que
 *    `GroupsSection.invitations.integration.test.tsx`), le VRAI store
 *    `useAuth` est utilisé pour vérifier l'optimistic update + le rollback.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

import {
  ONBOARDING_STEPS,
  deriveOnboardingTourState,
  finishOnboardingTour,
  goToOnboardingStep,
  nextOnboardingStep,
  replayOnboardingTour,
  skipOnboardingTour,
  startOnboardingTour,
  useOnboardingTourAutoStart,
} from './onboardingTour';

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

describe('deriveOnboardingTourState', () => {
  it('les deux champs null → not_started', () => {
    expect(
      deriveOnboardingTourState({ onboardingStep: null, onboardingCompletedAt: null }),
    ).toMatchObject({ status: 'not_started', step: null });
  });

  it('step posé, completedAt null → in_progress à cette étape', () => {
    expect(
      deriveOnboardingTourState({ onboardingStep: 'invite_link', onboardingCompletedAt: null }),
    ).toMatchObject({ status: 'in_progress', step: 'invite_link', stepIndex: 1 });
  });

  it('completedAt posé, step null → finished', () => {
    expect(
      deriveOnboardingTourState({
        onboardingStep: null,
        onboardingCompletedAt: new Date().toISOString(),
      }),
    ).toMatchObject({ status: 'finished', step: null });
  });

  it('les deux champs posés → finished (completedAt gagne)', () => {
    expect(
      deriveOnboardingTourState({
        onboardingStep: 'connect_messaging',
        onboardingCompletedAt: new Date().toISOString(),
      }),
    ).toMatchObject({ status: 'finished', step: null });
  });
});

describe('transitions onboardingTour (MAN-220 Task 3)', () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  it('start() persiste onboardingStep = première étape canonique, sans toucher completedAt', async () => {
    setUser();
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: ONBOARDING_STEPS[0] },
    });

    await startOnboardingTour();

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: '/auth/me',
        body: { onboardingStep: ONBOARDING_STEPS[0] },
      }),
    );
    expect(useAuth.getState().user?.onboardingStep).toBe(ONBOARDING_STEPS[0]);
  });

  it('goToOnboardingStep() persiste exactement l’étape demandée', async () => {
    setUser({ onboardingStep: ONBOARDING_STEPS[0] });
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'invite_link' },
    });

    await goToOnboardingStep('invite_link');

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({ body: { onboardingStep: 'invite_link' } }),
    );
  });

  it('next() avance à l’étape suivante dans l’ordre canonique de @nexus/shared', async () => {
    setUser({ onboardingStep: 'create_group' });
    mockedApi.mockResolvedValueOnce({ user: { ...BASE_USER, onboardingStep: 'invite_link' } });

    await nextOnboardingStep();

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({ body: { onboardingStep: 'invite_link' } }),
    );
  });

  it('next() sur la dernière étape termine le tutoriel (set completedAt)', async () => {
    const lastStep = ONBOARDING_STEPS.at(-1);
    if (!lastStep) throw new Error('ONBOARDING_STEPS ne doit jamais être vide');
    setUser({ onboardingStep: lastStep });
    mockedApi.mockResolvedValueOnce({
      user: {
        ...BASE_USER,
        onboardingStep: lastStep,
        onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await nextOnboardingStep();

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { onboardingCompletedAt: expect.any(String) as string },
      }),
    );
    const call = mockedApi.mock.calls[0]?.[0] as { body: { onboardingCompletedAt: string } };
    expect(call.body).not.toHaveProperty('onboardingStep');
  });

  it('next() ne fait rien si le tutoriel n’est pas en cours', async () => {
    setUser({ onboardingStep: null });

    await nextOnboardingStep();

    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('skip() pose uniquement onboardingCompletedAt', async () => {
    setUser({ onboardingStep: 'connect_messaging' });
    mockedApi.mockResolvedValueOnce({
      user: {
        ...BASE_USER,
        onboardingStep: 'connect_messaging',
        onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await skipOnboardingTour();

    const call = mockedApi.mock.calls[0]?.[0] as { body: Record<string, unknown> };
    expect(call.body).toEqual({ onboardingCompletedAt: expect.any(String) as string });
    expect(useAuth.getState().user?.onboardingCompletedAt).not.toBeNull();
  });

  it('finish() pose uniquement onboardingCompletedAt', async () => {
    setUser({ onboardingStep: 'public_share' });
    mockedApi.mockResolvedValueOnce({
      user: {
        ...BASE_USER,
        onboardingStep: 'public_share',
        onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await finishOnboardingTour();

    const call = mockedApi.mock.calls[0]?.[0] as { body: Record<string, unknown> };
    expect(call.body).toEqual({ onboardingCompletedAt: expect.any(String) as string });
  });

  it('replay() pose step=create_group ET completedAt=null explicitement', async () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: '2026-01-01T00:00:00.000Z' });
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'create_group', onboardingCompletedAt: null },
    });

    await replayOnboardingTour();

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { onboardingStep: 'create_group', onboardingCompletedAt: null },
      }),
    );
    expect(useAuth.getState().user?.onboardingStep).toBe('create_group');
    expect(useAuth.getState().user?.onboardingCompletedAt).toBeNull();
  });

  it('optimistic update immédiat, puis rollback si le PATCH échoue', async () => {
    setUser({ onboardingStep: 'create_group' });
    mockedApi.mockRejectedValueOnce(new Error('network down'));

    const promise = skipOnboardingTour();
    // Optimiste : appliqué avant même que la promesse réseau ne résolve.
    expect(useAuth.getState().user?.onboardingCompletedAt).not.toBeNull();

    await expect(promise).rejects.toThrow('network down');
    // Rollback : on revient exactement à l'état d'avant l'appel.
    expect(useAuth.getState().user?.onboardingCompletedAt).toBeNull();
    expect(useAuth.getState().user?.onboardingStep).toBe('create_group');
  });
});

describe('useOnboardingTourAutoStart (MAN-220 Task 4 — trigger/resume)', () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  it('un compte tout juste créé (les deux champs null) démarre le tutoriel', async () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: null });
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: ONBOARDING_STEPS[0] },
    });

    renderHook(() => useOnboardingTourAutoStart());

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1));
    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({ body: { onboardingStep: ONBOARDING_STEPS[0] } }),
    );
  });

  it('un compte déjà terminé ne redéclenche rien', () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: new Date().toISOString() });

    renderHook(() => useOnboardingTourAutoStart());

    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('un compte interrompu (step déjà posé) ne redéclenche rien — la reprise est déjà correcte telle quelle', () => {
    setUser({ onboardingStep: 'connect_messaging', onboardingCompletedAt: null });

    renderHook(() => useOnboardingTourAutoStart());

    expect(mockedApi).not.toHaveBeenCalled();
  });

  it("tant que l'auth est en cours d'initialisation, ne tente rien", () => {
    useAuth.setState({ user: null, initializing: true });

    renderHook(() => useOnboardingTourAutoStart());

    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('ne déclenche qu’une fois par user (pas de re-PATCH sur un re-render sans changement)', async () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: null });
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: ONBOARDING_STEPS[0] },
    });

    const { rerender } = renderHook(() => useOnboardingTourAutoStart());
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1));

    rerender();
    rerender();

    expect(mockedApi).toHaveBeenCalledTimes(1);
  });
});
