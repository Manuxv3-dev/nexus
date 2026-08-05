/**
 * Surface visible minimale du tutoriel de découverte (MAN-217 Phase 1 /
 * MAN-220 Task 4).
 *
 * Volontairement basique : un bandeau fixe "Étape N/5 — <titre>" + deux CTA
 * (Suivant/Passer). Pas de coachmark ciblé, pas de spotlight sur l'élément
 * concerné — ça arrive en Phase 3 via `driver.js`. Le vrai livrable de cette
 * phase est la state machine (`@/lib/onboardingTour`) ; ce composant n'en est
 * qu'un rendu jetable, conçu pour être trivial à remplacer sans toucher à la
 * logique de progression.
 *
 * Rendu par `AppShell`/`MobileShell` uniquement — inutile ailleurs (Settings,
 * écrans publics) puisque `status !== 'in_progress'` y suffit déjà à ne rien
 * afficher, mais la duplication de montage n'aurait aucun intérêt.
 */
import { useState } from 'react';

import { Button } from '@/components/ui';
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COPY,
  nextOnboardingStep,
  skipOnboardingTour,
  useOnboardingTour,
} from '@/lib/onboardingTour';
import { NX } from '@/lib/tokens';

const TOUR_TRANSITION_ERROR = 'Action impossible pour le moment. Réessaie.';

export function OnboardingTourBanner() {
  const { status, step, stepIndex, totalSteps } = useOnboardingTour();
  const [error, setError] = useState<string | null>(null);

  if (status !== 'in_progress' || !step) return null;

  const copy = ONBOARDING_STEP_COPY[step];

  // `.catch()` explicite plutôt que `void` nu (revue MAN-220) : un `void f()`
  // silencieux attache aucun handler — un PATCH raté sur réseau flaky fait
  // avancer l'étape à l'optimiste puis la fait revenir sans un mot (rollback
  // de `persistOnboardingPatch`), sans que l'utilisateur comprenne pourquoi.
  // Même pattern que `ReplayOnboardingTourRow` (`SettingsScreen.tsx`).
  const handleSkip = () => {
    setError(null);
    skipOnboardingTour().catch((err: unknown) => {
      console.warn('[onboarding] échec "Passer"', err);
      setError(TOUR_TRANSITION_ERROR);
    });
  };

  const handleNext = () => {
    setError(null);
    nextOnboardingStep().catch((err: unknown) => {
      console.warn('[onboarding] échec avancement du tutoriel', err);
      setError(TOUR_TRANSITION_ERROR);
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        maxWidth: 'calc(100vw - 32px)',
        padding: '12px 16px',
        borderRadius: NX.radius,
        background: NX.glassBg,
        backdropFilter: NX.glassBlur,
        WebkitBackdropFilter: NX.glassBlur,
        border: `0.5px solid ${NX.glassBorder}`,
        boxShadow: NX.glassShadow,
      }}
    >
      {/* `role="status"` posé ICI, pas sur le conteneur entier : sinon les
          lecteurs d'écran re-annoncent aussi les boutons Suivant/Passer à
          chaque changement d'étape (leur libellé ne change pourtant presque
          jamais), une verbosité inutile pour une région live. */}
      <div role="status" style={{ minWidth: 0 }}>
        <div
          style={{ fontSize: 11, fontWeight: 600, color: NX.primaryText, letterSpacing: '0.02em' }}
        >
          Étape {stepIndex + 1}/{totalSteps}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: NX.fg, marginTop: 2 }}>
          {copy.title}
        </div>
        <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2, maxWidth: 320 }}>
          {copy.description}
        </div>
        {error && <div style={{ fontSize: 11, color: NX.error, marginTop: 4 }}>{error}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <Button variant="ghost" size="sm" onClick={handleSkip}>
          Passer
        </Button>
        <Button variant="primary" size="sm" onClick={handleNext}>
          {stepIndex === ONBOARDING_STEPS.length - 1 ? 'Terminer' : 'Suivant'}
        </Button>
      </div>
    </div>
  );
}
