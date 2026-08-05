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
import { Button } from '@/components/ui';
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COPY,
  nextOnboardingStep,
  skipOnboardingTour,
  useOnboardingTour,
} from '@/lib/onboardingTour';
import { NX } from '@/lib/tokens';

export function OnboardingTourBanner() {
  const { status, step, stepIndex, totalSteps } = useOnboardingTour();

  if (status !== 'in_progress' || !step) return null;

  const copy = ONBOARDING_STEP_COPY[step];

  return (
    <div
      role="status"
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
      <div style={{ minWidth: 0 }}>
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
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <Button variant="ghost" size="sm" onClick={() => void skipOnboardingTour()}>
          Passer
        </Button>
        <Button variant="primary" size="sm" onClick={() => void nextOnboardingStep()}>
          {stepIndex === ONBOARDING_STEPS.length - 1 ? 'Terminer' : 'Suivant'}
        </Button>
      </div>
    </div>
  );
}
