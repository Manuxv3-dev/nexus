/**
 * Le `QueryClient` de l'application, construit ici plutôt qu'inline dans
 * `main.tsx` pour que les tests puissent exercer le même client que la prod —
 * la règle d'invalidation ci-dessous n'aurait aucune valeur si elle n'existait
 * que dans le bootstrap.
 */
import { MutationCache, QueryClient } from '@tanstack/react-query';

/**
 * Clé racine du feed Home. La vraie clé est `['home', 'feed', <weekStart>]` ;
 * `invalidateQueries` matche par préfixe (`exact: false` par défaut), donc
 * invalider `['home']` couvre toutes les semaines en cache.
 */
const HOME_QUERY_KEY = ['home'] as const;

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
 * Home. Une mutation faite ailleurs se contente de marquer le cache périmé ;
 * une mutation faite depuis la Home (les QuickActions, un RSVP, une notif lue)
 * est précisément celle qu'on veut voir se refléter tout de suite.
 *
 * Ne couvre que les mutations locales : un changement fait par quelqu'un
 * d'autre arrive par WS, et c'est `useKillerFeaturesWs` qui l'invalide.
 */
export function createQueryClient(): QueryClient {
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
