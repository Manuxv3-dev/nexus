/**
 * Tutoriel de découverte (MAN-217 Phase 1 / MAN-220) — state machine client.
 *
 * L'état persiste sur deux champs du user (`onboardingStep`,
 * `onboardingCompletedAt`, cf. `@/lib/auth`), mais seul `onboardingStep` se
 * PATCH tel quel : `onboardingCompletedAt` est dérivé côté serveur (MAN-232) à
 * partir d'un intent, `onboardingCompleted` (`true` = marquer terminé, poser
 * `new Date()` ; `null` = reset explicite / replay). Écrits via
 * `PATCH /auth/me` (cf. `packages/backend/src/routes/auth/schemas.ts` —
 * `UpdateMeBodySchema` fait un `'field' in req.body` presence check : envoyer
 * `null` explicitement réinitialise le champ, l'omettre le laisse intact).
 *
 * Pas de store zustand dédié : l'état affiché (`useOnboardingTour`) est
 * entièrement DÉRIVÉ du user de `useAuth` (source de vérité unique), pas
 * dupliqué. Les transitions lisent/écrivent directement `useAuth` en
 * mirorant le pattern optimiste + rollback de `setLandingPreference`
 * (`@/lib/auth`, cf. JSDoc de la fonction).
 */
import { OnboardingStepSchema, type OnboardingStep } from '@nexus/shared';
import { useEffect, useMemo, useRef } from 'react';

import { api } from './api';
import { MeReply, useAuth } from './auth';
import { useGroups } from './queries';

/**
 * Ordre canonique des étapes — dérivé de l'enum partagé (source de vérité
 * unique), jamais dupliqué en dur : un ajout/réordonnancement d'étape côté
 * `@nexus/shared` se propage automatiquement ici.
 *
 * Type volontairement NON élargi en `OnboardingStep[]` : `.options` de Zod
 * garde le tuple littéral, donc `ONBOARDING_STEPS[0]` reste typé
 * `OnboardingStep` (pas `| undefined`) malgré `noUncheckedIndexedAccess` —
 * un élargissement forcerait un cast ou un accès défensif inutile pour un
 * index constant sur un tableau non vide par construction.
 */
export const ONBOARDING_STEPS = OnboardingStepSchema.options;

export type OnboardingTourStatus = 'not_started' | 'in_progress' | 'finished';

export interface OnboardingTourState {
  status: OnboardingTourStatus;
  /** Étape courante — non-null ssi `status === 'in_progress'`. */
  step: OnboardingStep | null;
  /** Index 0-based de `step` dans `ONBOARDING_STEPS` (-1 si pas en cours). */
  stepIndex: number;
  totalSteps: number;
}

/**
 * Copie FR courte par étape — le contenu guidé complet (coachmarks ciblés)
 * arrive en Phase 3 (driver.js). Ici, juste de quoi afficher un titre +
 * description dans la surface minimale de la Phase 1 (cf. `OnboardingTourBanner`).
 */
export const ONBOARDING_STEP_COPY: Record<OnboardingStep, { title: string; description: string }> =
  {
    create_group: {
      title: 'Crée ton premier groupe',
      description: 'Un groupe = ta bande. Utilise le bouton "+" dans la barre latérale.',
    },
    invite_link: {
      title: 'Invite ta bande',
      description: 'Partage un lien d’invitation depuis les Réglages du groupe.',
    },
    connect_messaging: {
      title: 'Connecte une messagerie',
      description: 'Branche Discord, WhatsApp ou une autre messagerie depuis les Réglages.',
    },
    first_orga_item: {
      title: 'Organise ta bande',
      description: 'Crée un événement, un sondage, une dépense ou une tâche.',
    },
    public_share: {
      title: 'Partage en dehors de nexus',
      description: 'Génère un lien public pour partager un item avec qui tu veux.',
    },
  };

export interface OnboardingTourFields {
  onboardingStep: OnboardingStep | null;
  onboardingCompletedAt: string | null;
}

/**
 * Dérive le statut du tutoriel depuis les deux champs persistés du user.
 * Pure — pas d'accès au store, testable sur les 4 combinaisons sans mock.
 *
 * Sémantique retenue pour "les deux champs posés" (cas non explicité par le
 * ticket) : `finished` gagne. `onboardingCompletedAt` renseigné signifie
 * "ne plus jamais montrer le tutoriel" (fin normale OU skip) — le `step`
 * résiduel n'est qu'un vestige de la dernière position avant complétion et ne
 * doit rien déclencher. C'est aussi le seul choix cohérent avec le replay
 * (qui pose explicitement `step='create_group'` ET `completedAt=null`
 * ensemble) : si `step` seul suffisait à relancer le tuto, un replay et une
 * complétion normale en fin de parcours (qui laisse `step` sur la dernière
 * étape) se confondraient.
 */
export function deriveOnboardingTourState(fields: OnboardingTourFields): OnboardingTourState {
  const totalSteps = ONBOARDING_STEPS.length;
  if (fields.onboardingCompletedAt) {
    return { status: 'finished', step: null, stepIndex: -1, totalSteps };
  }
  if (fields.onboardingStep) {
    const stepIndex = ONBOARDING_STEPS.indexOf(fields.onboardingStep);
    return { status: 'in_progress', step: fields.onboardingStep, stepIndex, totalSteps };
  }
  return { status: 'not_started', step: null, stepIndex: -1, totalSteps };
}

/**
 * Hook de lecture — statut dérivé du user courant, recalculé à chaque
 * changement de `onboardingStep`/`onboardingCompletedAt`. Pas d'utilisateur
 * connecté → mêmes valeurs par défaut que "jamais démarré" (`?? null` sur les
 * deux champs) : l'appelant n'affiche de toute façon jamais rien sans user
 * (cf. `OnboardingTourBanner`, monté seulement sous `AppShell`/`MobileShell`
 * qui gardent déjà la route sur `user`).
 */
export function useOnboardingTour(): OnboardingTourState {
  const onboardingStep = useAuth((s) => s.user?.onboardingStep ?? null);
  const onboardingCompletedAt = useAuth((s) => s.user?.onboardingCompletedAt ?? null);
  return useMemo(
    () => deriveOnboardingTourState({ onboardingStep, onboardingCompletedAt }),
    [onboardingStep, onboardingCompletedAt],
  );
}

/**
 * Étape d'entrée du tutoriel — PAS toujours `ONBOARDING_STEPS[0]` (MAN-220
 * revue de code, fix du bug "l'UI affirme un état déjà faux" — même classe
 * que MAN-196/197/214).
 *
 * Un user qui a déjà au moins un groupe au moment où le tutoriel démarre ou
 * relance a, par construction, déjà "créé un groupe" :
 *  - un invité qui vient d'accepter une invitation (`?invite=<slug>` →
 *    `/invite/$slug` → rejoint un groupe existant → atterrit sur une route
 *    authentifiée où `useOnboardingTourAutoStart` se déclenche) ;
 *  - N'IMPORTE QUEL replay ("Relancer le tutoriel" depuis les Réglages) : par
 *    définition, un user qui relance est déjà établi et a forcément déjà
 *    au moins un groupe.
 * Lui remontrer "Crée ton premier groupe" mentirait sur son état réel.
 *
 * Fonction pure et testable sans mock — volontairement sans dépendance à
 * React Query : c'est à l'appelant (`useOnboardingTourAutoStart`,
 * `ReplayOnboardingTourRow`) de lire `useGroups()` et de fournir `hasGroups`,
 * pour garder cette state machine testable sans provider ni réseau.
 */
export function entryOnboardingStep(hasGroups: boolean): OnboardingStep {
  return hasGroups ? ONBOARDING_STEPS[1] : ONBOARDING_STEPS[0];
}

/**
 * Trigger/resume (MAN-220 Task 4) : monté une seule fois, tout en haut de
 * l'arbre (`RootComponent` de `router.tsx`), pour couvrir TOUTE route
 * authentifiée — pas seulement `/app` — et remplacer l'ancien hop impératif
 * `navigate({ to: '/onboarding' })` de `RegisterScreen` (qui ne se
 * déclenchait qu'une fois, juste après l'inscription : un refresh ou un
 * retour plus tard perdait le tutoriel pour de bon, cf. ticket).
 *
 * Ne fait qu'une chose : si le user chargé est réellement "jamais démarré"
 * (les deux champs à null), démarre le tutoriel (`onboardingStep` posé à la
 * première étape). Un user "interrompu" (`onboardingStep` déjà posé) ou
 * "terminé" (`onboardingCompletedAt` posé) n'a besoin d'aucune action ici —
 * `useOnboardingTour()` dérive directement le bon état de reprise depuis les
 * champs déjà persistés, `OnboardingTourBanner` s'affiche donc automatiquement
 * à la bonne étape sans code de "resume" séparé.
 *
 * Dédoublonnage par `userId` (pas juste un booléen "déjà tenté") : ce hook
 * vit au niveau racine et ne démonte jamais entre un logout et un login
 * suivant dans la même session SPA — un simple ref booléen bloquerait le
 * déclenchement pour le second compte. Protège aussi contre le double-appel
 * React StrictMode (même schéma que `initInFlight` dans `@/lib/auth`) : la
 * première invocation pose le ref de façon synchrone (avant le premier
 * `await` de `startOnboardingTour`), donc la ré-invocation immédiate en dev
 * voit déjà `attemptedForUserRef.current === userId` et sort sans rien faire.
 *
 * Étape d'entrée dérivée du VRAI état groupes (`useGroups()`, cf.
 * `entryOnboardingStep`) plutôt que codée en dur sur la première étape : un
 * user qui atterrit ici avec déjà un groupe (invité venant d'accepter une
 * invitation) saute directement "Crée ton premier groupe". Le déclenchement
 * attend la fin du chargement des groupes (`groupsQ.isLoading`) — démarrer
 * avec `data` encore `undefined` traiterait à tort "pas encore chargé" comme
 * "aucun groupe".
 *
 * Le ref est posé de façon synchrone AVANT l'appel réseau (anti-double-appel
 * StrictMode/re-render, cf. ci-dessus) mais réinitialisé dans le `.catch()` :
 * un PATCH raté ne doit pas bloquer toute retentative pour le reste de la
 * session — l'effet se relance simplement au prochain re-render (ex :
 * `groupsQ` qui se recharge).
 */
export function useOnboardingTourAutoStart(): void {
  const initializing = useAuth((s) => s.initializing);
  const userId = useAuth((s) => s.user?.id ?? null);
  const { status } = useOnboardingTour();
  const groupsQ = useGroups();
  const attemptedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializing || !userId) return;
    if (attemptedForUserRef.current === userId) return;
    if (status !== 'not_started') return;
    if (groupsQ.isLoading) return;
    attemptedForUserRef.current = userId;
    startOnboardingTour(!!groupsQ.data?.length).catch((err: unknown) => {
      console.warn('[onboarding] échec du démarrage automatique du tutoriel', err);
      attemptedForUserRef.current = null;
    });
  }, [initializing, userId, status, groupsQ.isLoading, groupsQ.data]);
}

interface OnboardingPatch {
  onboardingStep?: OnboardingStep | null;
  /**
   * Intent, pas une date (MAN-232) : `true` marque le tutoriel terminé (le
   * serveur pose `new Date()`), `null` le réinitialise (replay). Le client
   * ne fournit jamais de timestamp — cf. JSDoc de fichier.
   */
  onboardingCompleted?: true | null;
}

/**
 * PATCH /auth/me générique aux deux champs onboarding — mirror exact du
 * pattern optimiste + rollback de `setLandingPreference` (`@/lib/auth`).
 * Seuls les champs présents dans `patch` sont envoyés (et donc modifiés côté
 * serveur) — cf. presence-check backend en tête de fichier : omettre un champ
 * le laisse intact, le poser à `null` le réinitialise explicitement.
 *
 * L'optimistic update de `onboardingCompletedAt` (MAN-232) utilise l'horloge
 * LOCALE (`new Date().toISOString()`) comme approximation immédiate : la
 * vraie valeur, posée par le serveur, écrase cette approximation dès la
 * réponse du PATCH (`useAuth.setState({ user: reply.user })` ci-dessous) —
 * l'écart (latence réseau, horloge client légèrement désynchronisée) n'est
 * jamais visible plus qu'un instant et ne casse pas `deriveOnboardingTourState`
 * (qui ne teste que la présence/absence, jamais la valeur).
 */
async function persistOnboardingPatch(patch: OnboardingPatch): Promise<void> {
  const current = useAuth.getState().user;
  if (!current) return;
  const optimistic = { ...current };
  if ('onboardingStep' in patch) optimistic.onboardingStep = patch.onboardingStep ?? null;
  if ('onboardingCompleted' in patch) {
    optimistic.onboardingCompletedAt = patch.onboardingCompleted ? new Date().toISOString() : null;
  }
  useAuth.setState({ user: optimistic });
  try {
    const reply = await api({ method: 'PATCH', path: '/auth/me', body: patch, reply: MeReply });
    useAuth.setState({ user: reply.user });
  } catch (err) {
    useAuth.setState({ user: current });
    throw err;
  }
}

/**
 * Démarre le tutoriel — à `entryOnboardingStep(hasGroups)`, pas toujours la
 * première étape canonique (cf. JSDoc de `entryOnboardingStep`). No-op si pas
 * de user connecté.
 */
export async function startOnboardingTour(hasGroups: boolean): Promise<void> {
  await persistOnboardingPatch({ onboardingStep: entryOnboardingStep(hasGroups) });
}

/** Positionne le tutoriel sur une étape donnée (utilisé par `next()` et les tests). */
export async function goToOnboardingStep(step: OnboardingStep): Promise<void> {
  await persistOnboardingPatch({ onboardingStep: step });
}

/**
 * Avance à l'étape suivante dans l'ordre canonique. Sur la dernière étape,
 * "Suivant" termine le tutoriel plutôt que de ne rien faire — comportement le
 * plus naturel pour le CTA unique de la surface minimale (cf.
 * `OnboardingTourBanner`). No-op si le tutoriel n'est pas en cours.
 */
export async function nextOnboardingStep(): Promise<void> {
  const current = useAuth.getState().user?.onboardingStep ?? null;
  if (!current) return;
  const idx = ONBOARDING_STEPS.indexOf(current);
  const next = ONBOARDING_STEPS[idx + 1];
  if (next) {
    await goToOnboardingStep(next);
  } else {
    await finishOnboardingTour();
  }
}

/** Passe le tutoriel (bouton "Passer") : ne réapparaîtra plus. */
export async function skipOnboardingTour(): Promise<void> {
  await persistOnboardingPatch({ onboardingCompleted: true });
}

/** Termine le tutoriel (dernière étape validée) : ne réapparaîtra plus. */
export async function finishOnboardingTour(): Promise<void> {
  await persistOnboardingPatch({ onboardingCompleted: true });
}

/**
 * Relance le tutoriel (Settings → "Relancer le tutoriel") — à
 * `entryOnboardingStep(hasGroups)`. En pratique un replay part quasi toujours
 * avec `hasGroups = true` (un user qui relance est établi, cf. JSDoc de
 * `entryOnboardingStep`), mais le paramètre reste explicite plutôt que de
 * coder cette hypothèse en dur : c'est l'appelant (`ReplayOnboardingTourRow`)
 * qui lit le VRAI état via `useGroups()`.
 */
export async function replayOnboardingTour(hasGroups: boolean): Promise<void> {
  await persistOnboardingPatch({
    onboardingStep: entryOnboardingStep(hasGroups),
    onboardingCompleted: null,
  });
}
