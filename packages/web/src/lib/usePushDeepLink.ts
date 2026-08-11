/**
 * Effet partagé entre `AppShell` et `MobileShell` (cf. MAN-151) : consomme
 * les query params `?groupId&pane&sourceId` posés sur `/app` par
 * `buildDeepLinkUrl`/`buildDeepLinkSearch` (cf. `readPushDeepLinkParams`),
 * nettoie l'URL une fois lus (usage unique — un refresh ne doit pas rejouer
 * le deep-link), puis valide que le groupe ciblé appartient toujours à
 * l'utilisateur avant d'appliquer la cible.
 *
 * Seule la validation + le nettoyage d'URL sont communs aux deux shells :
 * l'application de la cible diverge (`AppShell` court-circuite la pref de
 * landing via `landingAppliedRef`, `MobileShell` force en plus `stack` sur
 * `'detail'`) — d'où le callback `onTarget` plutôt qu'un state géré ici.
 *
 * La query string vient de l'état du router, pas de `window.location` :
 * `/app` est une route unique et `usePushNavigate` (cas « une fenêtre est
 * déjà ouverte ») fait une navigation search-only qui ne remonte pas le
 * shell appelant — l'effet doit réagir au changement de `searchStr`, pas
 * seulement au montage.
 */
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { readPushDeepLinkParams, type PushDeepLinkTarget } from './pushDeepLink';

export interface UsePushDeepLinkOptions {
  /** Effet inactif tant que `false` (auth pas encore résolue, ou groupes encore en chargement — la validation d'appartenance ci-dessous a besoin de la liste à jour). */
  enabled: boolean;
  /** Groupes du user courant, pour valider que `deepLink.groupId` lui appartient toujours avant d'appliquer la cible — sans quoi une URL forgée ou un groupe quitté depuis l'envoi du push appliquerait la cible dans le mauvais contexte. */
  groups: readonly { id: string }[];
  /** Appelé avec la cible résolue et validée — chaque shell l'applique à son propre état (`pendingOpen`, `stack`, ...). */
  onTarget: (target: PushDeepLinkTarget) => void;
}

export function usePushDeepLink({ enabled, groups, onTarget }: UsePushDeepLinkOptions): void {
  const navigate = useNavigate();
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });

  // Ref plutôt que dépendance d'effet : `onTarget` est typiquement une
  // closure inline côté appelant, la mémoiser ne doit pas conditionner le
  // déclenchement de l'effet (cf. `inviteDismissedRef` dans `GroupMenu.tsx`
  // pour le même besoin de lecture synchrone sans réabonner l'effet).
  const onTargetRef = useRef(onTarget);
  onTargetRef.current = onTarget;

  useEffect(() => {
    if (!enabled) return;
    const deepLink = readPushDeepLinkParams(searchStr);
    if (!deepLink) return;
    // Usage unique : on nettoie l'URL même si la cible finit par être
    // rejetée, sinon un refresh la rejouerait indéfiniment.
    void navigate({ to: '/app', search: {}, replace: true });
    if (!groups.some((g) => g.id === deepLink.groupId)) return;
    onTargetRef.current(deepLink);
  }, [enabled, groups, navigate, searchStr]);
}
