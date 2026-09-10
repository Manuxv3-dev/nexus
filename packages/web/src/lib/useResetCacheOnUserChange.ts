/**
 * Vide le cache TanStack quand l'identité authentifiée change.
 *
 * Le `QueryClient` est un singleton de module (`lib/queryClient.ts`) et n'a
 * aucune persistance : il vit donc exactement aussi longtemps que l'onglet ou
 * la fenêtre desktop. Or l'app desktop n'est jamais rechargée entre deux
 * sessions — on se déconnecte et quelqu'un d'autre se connecte dans le même
 * processus. Sans ce hook, tout ce que le compte précédent a mis en cache
 * reste servable au suivant : la plupart des queryKeys de `lib/queries.ts` ne
 * portent pas de `userId`, donc les clés des deux comptes sont **identiques**
 * (cf. ticket 10bc1096).
 *
 * Le vidage se fait ici plutôt que dans `logout()` pour deux raisons :
 *
 * 1. **Il couvre tous les chemins**, pas seulement le bouton « se
 *    déconnecter » : expiration du refresh token, suppression de compte,
 *    `logoutAll`, ou n'importe quel futur code qui remettrait `user` à null.
 *    C'est le changement d'identité qui est l'événement, pas l'appel d'API.
 * 2. **Il ne peut pas déclencher de refetch parasite.** Un `clear()` appelé
 *    depuis `logout()` s'exécuterait pendant que l'arbre authentifié est
 *    encore monté : les observers actifs repartiraient aussitôt en fetch,
 *    sans token, pour une volée de 401. Ici on est dans un `useEffect`, donc
 *    après le commit qui a démonté cet arbre — il ne reste plus d'observer
 *    à réveiller.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useAuth } from './auth';

export function useResetCacheOnUserChange(): void {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  // Initialisé à la valeur du premier rendu : au démarrage à froid, la
  // transition « pas encore d'utilisateur » → « utilisateur résolu » n'est pas
  // un changement d'identité et ne doit rien jeter (le router précharge sur
  // `intent`, ces entrées-là sont légitimes).
  const previousUserId = useRef<string | undefined>(userId);

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous !== undefined && previous !== userId) {
      qc.clear();
    }
  }, [qc, userId]);
}
