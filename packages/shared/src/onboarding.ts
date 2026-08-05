import { z } from 'zod';

/**
 * Étapes du tutoriel de découverte affiché au premier login (cf. MAN-217
 * Phase 1 / MAN-220).
 *
 * Source de vérité unique pour l'API (`GET /auth/me`, `PATCH /auth/me`) et le
 * client web/desktop — évite la dérive copy-paste déjà constatée sur
 * `LandingPreference` (dupliqué entre `@nexus/web` et `@nexus/backend`).
 *
 * Persisté sur `users.onboarding_step` (nullable — `null` = jamais démarré).
 */
export const OnboardingStepSchema = z.enum([
  'create_group',
  'invite_link',
  'connect_messaging',
  'first_orga_item',
  'public_share',
]);
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;
