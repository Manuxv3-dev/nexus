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
 *    depuis `logout()` s'exécuterait au milieu du rendu, pendant que l'arbre
 *    authentifié est encore monté : les observers actifs repartiraient en
 *    fetch, sans token, pour une volée de 401. Ici on est dans un
 *    `useEffect`, donc après le commit — et sur le chemin réel de
 *    déconnexion, cet arbre a été démonté par ce même commit (les écrans
 *    authentifiés rendent `null` ou un spinner dès que `user` tombe).
 *
 * Le vidage se déclenche dans **les deux sens** : au départ d'une identité et
 * à l'arrivée de la suivante. Le second n'est pas de la redondance — entre
 * les deux, une mutation du compte partant peut encore être **en vol**.
 * `clear()` ne l'annule pas : son `onSuccess` s'exécute après, et réécrit des
 * données du compte précédent via `setQueryData` sur des clés qui ne portent
 * pas de `userId`. La fenêtre est d'un aller-retour réseau, mais la
 * conséquence est celle du ticket. Dans le cas nominal, le second vidage
 * porte sur un cache déjà vide : il ne coûte rien.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useAuth } from './auth';

export function useResetCacheOnUserChange(): void {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const previousUserId = useRef<string | undefined>(userId);
  // Au démarrage à froid, `init()` résout l'auth de façon asynchrone : la
  // transition « pas encore d'utilisateur » → « utilisateur résolu » n'est pas
  // un changement d'identité et ne doit rien jeter. Les pages publiques
  // (`/e/:slug`, `/p/:slug`) fetchent légitimement avant que l'auth soit
  // résolue, et ce cache-là leur appartient. D'où ce drapeau plutôt qu'un
  // simple test sur `previous !== undefined` : il distingue « personne ne
  // s'est encore connecté » de « quelqu'un vient de partir ».
  const someoneWasSignedIn = useRef<boolean>(userId !== undefined);

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous === userId) return;
    if (someoneWasSignedIn.current) qc.clear();
    if (userId !== undefined) someoneWasSignedIn.current = true;
  }, [qc, userId]);
}
