/**
 * Le `QueryClient` de l'application, construit ici plutôt qu'inline dans
 * `main.tsx` pour que les tests puissent exercer le même client que la prod —
 * la règle d'invalidation ci-dessous n'aurait aucune valeur si elle n'existait
 * que dans le bootstrap.
 */
import { MutationCache, QueryClient } from '@tanstack/react-query';

/**
 * Racine de la queryKey du feed Home, **partagée** avec `useHomeFeed` qui la
 * préfixe (`[...HOME_QUERY_KEY, 'feed', weekStart]`).
 *
 * Exportée précisément pour qu'il n'en existe qu'un exemplaire : la règle
 * d'invalidation ci-dessous repose sur le matching par préfixe de TanStack
 * (`exact: false` par défaut), donc deux littéraux indépendants qui divergent
 * transformeraient la règle en no-op **silencieux** — aucune erreur, juste le
 * bug d'origine qui revient. C'est le mode de défaillance que cette règle
 * existe pour supprimer ; le recopier ici l'aurait juste déplacé d'un cran.
 */
export const HOME_QUERY_KEY = ['home'] as const;

/**
 * Crée le `QueryClient` de l'app.
 *
 * **Invalidation du feed Home : une règle globale, pas 19 recopies.** La Home
 * agrège sept sections alimentées par presque toutes les entités du produit
 * (events, RSVP, sondages, votes, dépenses, règlements, todos, notifications).
 * Câbler `invalidateQueries(['home'])` dans chaque `onSuccess` demanderait une
 * vingtaine de call sites, dont chaque mutation future ajouterait un — et une
 * omission ne se voit pas : elle se manifeste en « la Home met jusqu'à une
 * minute à afficher ce que je viens de créer » (cf. ticket 0df77e79), jamais
 * en erreur. On prend donc le point unique du `MutationCache`.
 *
 * Le coût est nul en pratique : `invalidateQueries` ne déclenche un refetch que
 * pour les queries **actives**, et `['home', 'feed', …]` n'est monté que sur la
 * Home. Une mutation faite ailleurs se contente de marquer le cache périmé.
 *
 * Ce marquage est d'ailleurs le vrai mécanisme du correctif pour le cas du
 * ticket : les QuickActions **naviguent** vers l'écran de création, donc la
 * Home est démontée quand la mutation aboutit. Sans la règle, `staleTime`
 * resservait le cache tel quel au retour. Le refetch immédiat, lui, ne joue
 * que pour les mutations déclenchées sans quitter la Home (une notif lue
 * depuis la cloche, par exemple).
 *
 * Ne couvre que les mutations locales : un changement fait par quelqu'un
 * d'autre arrive par WS, et c'est `useKillerFeaturesWs` qui l'invalide.
 */
export function createQueryClient(): QueryClient {
  // L'annotation explicite n'est pas requise par TS (le callback du
  // `MutationCache` est contextuellement typé, donc pas d'inférence
  // circulaire) — elle est là pour signaler l'auto-référence. La closure ne
  // s'exécute qu'après l'affectation : pas de TDZ.
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
    mutationCache: new MutationCache({
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: HOME_QUERY_KEY });
      },
    }),
  });
  return client;
}
