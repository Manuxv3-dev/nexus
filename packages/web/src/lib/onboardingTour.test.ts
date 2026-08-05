/**
 * `lib/onboardingTour.ts` — state machine du tutoriel de découverte
 * (MAN-217 Phase 1 / MAN-220, Task 3 + revue de code Fix 3/Fix 5).
 *
 * Familles de tests :
 *  - `deriveOnboardingTourState` : fonction pure, testée sur les 4
 *    combinaisons des deux champs persistés (aucun mock nécessaire).
 *  - `entryOnboardingStep` : fonction pure, testée sur ses 2 entrées possibles
 *    (aucun mock nécessaire non plus).
 *  - transitions (`start`/`next`/`skip`/`finish`/`replay`) : `@/lib/api` est
 *    mocké à la frontière réseau (même pattern que
 *    `GroupsSection.invitations.integration.test.tsx`), le VRAI store
 *    `useAuth` est utilisé pour vérifier l'optimistic update + le rollback.
 *  - `useOnboardingTourAutoStart` : `@/lib/queries` est mocké pour contrôler
 *    `useGroups()` (nombre de groupes → étape d'entrée), même frontière que
 *    les tests de composants qui consomment ce hook (ex : `AppShell.test.tsx`).
 */
import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

// Ref mutable (pas un `vi.fn()` hoisté) — même pattern que `groupsRef` dans
// `AppShell.pushDeepLink.test.tsx` : évite la friction de typage d'un mock de
// hook React Query directement assigné dans le facteur `vi.mock`.
const { groupsStateRef } = vi.hoisted(() => ({
  groupsStateRef: { current: { data: [] as { id: string }[] | undefined, isLoading: false } },
}));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return { ...actual, useGroups: () => groupsStateRef.current };
});

import {
  ONBOARDING_STEPS,
  deriveOnboardingTourState,
  entryOnboardingStep,
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

describe('entryOnboardingStep (MAN-220 revue de code, Fix 3)', () => {
  it('sans groupe → create_group (rien encore créé)', () => {
    expect(entryOnboardingStep(false)).toBe('create_group');
  });

  it('avec au moins un groupe → invite_link (le user a déjà "créé un groupe")', () => {
    expect(entryOnboardingStep(true)).toBe('invite_link');
  });
});

describe('transitions onboardingTour (MAN-220 Task 3)', () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  it('start(false) persiste onboardingStep = première étape canonique, sans toucher completedAt', async () => {
    setUser();
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: ONBOARDING_STEPS[0] },
    });

    await startOnboardingTour(false);

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: '/auth/me',
        body: { onboardingStep: ONBOARDING_STEPS[0] },
      }),
    );
    expect(useAuth.getState().user?.onboardingStep).toBe(ONBOARDING_STEPS[0]);
  });

  it('start(true) démarre à invite_link — un user avec déjà un groupe saute "Crée ton premier groupe"', async () => {
    setUser();
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'invite_link' },
    });

    await startOnboardingTour(true);

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({ body: { onboardingStep: 'invite_link' } }),
    );
    expect(useAuth.getState().user?.onboardingStep).toBe('invite_link');
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

  it('replay(false) pose step=create_group ET completedAt=null explicitement', async () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: '2026-01-01T00:00:00.000Z' });
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'create_group', onboardingCompletedAt: null },
    });

    await replayOnboardingTour(false);

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { onboardingStep: 'create_group', onboardingCompletedAt: null },
      }),
    );
    expect(useAuth.getState().user?.onboardingStep).toBe('create_group');
    expect(useAuth.getState().user?.onboardingCompletedAt).toBeNull();
  });

  it('replay(true) pose step=invite_link ET completedAt=null — un replay part quasi toujours avec un groupe existant', async () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: '2026-01-01T00:00:00.000Z' });
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'invite_link', onboardingCompletedAt: null },
    });

    await replayOnboardingTour(true);

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { onboardingStep: 'invite_link', onboardingCompletedAt: null },
      }),
    );
    expect(useAuth.getState().user?.onboardingStep).toBe('invite_link');
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
    // Défaut : aucun groupe, comme un compte tout juste créé. Les tests qui
    // ont besoin d'un autre état de `useGroups()` l'écrasent explicitement.
    groupsStateRef.current = { data: [], isLoading: false };
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  it('un compte tout juste créé (les deux champs null, aucun groupe) démarre le tutoriel à create_group', async () => {
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

  it('un compte invité qui a déjà un groupe démarre directement à invite_link (MAN-220 revue de code, Fix 3)', async () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: null });
    groupsStateRef.current = { data: [{ id: 'g1' }], isLoading: false };
    mockedApi.mockResolvedValueOnce({
      user: { ...BASE_USER, onboardingStep: 'invite_link' },
    });

    renderHook(() => useOnboardingTourAutoStart());

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1));
    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({ body: { onboardingStep: 'invite_link' } }),
    );
  });

  it("attend la fin du chargement des groupes avant de démarrer — évite de traiter data=undefined comme 'aucun groupe'", () => {
    setUser({ onboardingStep: null, onboardingCompletedAt: null });
    groupsStateRef.current = { data: undefined, isLoading: true };

    renderHook(() => useOnboardingTourAutoStart());

    expect(mockedApi).not.toHaveBeenCalled();
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

  it(
    'survit au double-appel React StrictMode (dédoublonnage synchrone par ref, ' +
      'JSDoc de `useOnboardingTourAutoStart` — MAN-220 revue de code, Fix 6)',
    async () => {
      setUser({ onboardingStep: null, onboardingCompletedAt: null });
      mockedApi.mockResolvedValueOnce({
        user: { ...BASE_USER, onboardingStep: ONBOARDING_STEPS[0] },
      });

      renderHook(() => useOnboardingTourAutoStart(), { wrapper: StrictMode });

      await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1));
      // StrictMode monte/démonte/remonte en dev : laisse le temps à un
      // éventuel second appel de se produire avant de conclure.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockedApi).toHaveBeenCalledTimes(1);
    },
  );

  it(
    'logout puis login sous un autre compte redéclenche le tutoriel pour ce nouveau compte ' +
      '(dédoublonnage par userId, pas juste un booléen — MAN-220 revue de code, Fix 6)',
    async () => {
      setUser({ id: 'user-a', onboardingStep: null, onboardingCompletedAt: null });
      mockedApi.mockResolvedValueOnce({
        user: { ...BASE_USER, id: 'user-a', onboardingStep: ONBOARDING_STEPS[0] },
      });

      const { rerender } = renderHook(() => useOnboardingTourAutoStart());
      await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1));

      // Logout : le hook, monté au niveau racine, ne démonte jamais.
      useAuth.setState({ user: null, initializing: false });
      rerender();
      expect(mockedApi).toHaveBeenCalledTimes(1);

      // Login sous un compte DIFFÉRENT, lui aussi "jamais démarré".
      setUser({ id: 'user-b', onboardingStep: null, onboardingCompletedAt: null });
      mockedApi.mockResolvedValueOnce({
        user: { ...BASE_USER, id: 'user-b', onboardingStep: ONBOARDING_STEPS[0] },
      });
      rerender();

      await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2));
      expect(mockedApi).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ body: { onboardingStep: ONBOARDING_STEPS[0] } }),
      );
    },
  );
});
