/**
 * Rend un résultat de query en refusant d'affirmer le vide depuis l'ignorance
 * (MAN-244).
 *
 * ## Le défaut corrigé
 *
 * Huit sites de `@nexus/web` portaient le même motif :
 *
 * ```tsx
 * const items = q.data ?? [];
 * if (q.isLoading) return <Loading />;
 * return items.length === 0 ? <EmptyState /> : <List items={items} />;
 * ```
 *
 * Aucune branche `isError`. Une requête en échec laisse `data` à `undefined`,
 * donc `items` vide, donc l'UI annonce sereinement qu'il n'y a rien — alors
 * qu'elle n'en sait rien. Sur mobile (réseau instable, token expiré) c'est le
 * cas courant, pas le cas limite. Le motif avait déjà été corrigé ponctuellement
 * sur MAN-231 et était réapparu huit fois : d'où une garantie portée par le
 * type plutôt que par la vigilance.
 *
 * ## Le contrat
 *
 * `error` est **obligatoire** : omettre le cas d'échec devient une erreur de
 * compilation. `empty` est **optionnel**, parce que tous les appelants ne
 * décident pas de la vacuité à cet endroit — les dashboards features la gèrent
 * plus bas, dans leur composant de liste, et passent donc le tableau vide aux
 * children sans état vide intermédiaire.
 *
 * ## `isPending`, jamais `isLoading`
 *
 * En TanStack Query v5, une query désactivée (`enabled: false`) rapporte
 * `isLoading === false` **et** `isPending === true`. Plusieurs queries de l'app
 * sont désactivées le temps que l'auth se résolve (`enabled: !!userId &&
 * !initializing`) : lire `isLoading` afficherait le vide pendant toute cette
 * fenêtre. Le composant lit `isPending` en interne pour que l'appelant ne
 * puisse pas se tromper — c'est précisément le piège de MAN-231.
 */
import type { ReactNode } from 'react';

/**
 * Sous-ensemble d'un `UseQueryResult` — volontairement structurel plutôt
 * qu'importé de TanStack : ça garde le composant testable avec des objets
 * littéraux, sans construire un vrai `QueryClient`.
 */
export interface AsyncSectionQuery<T> {
  isPending: boolean;
  isError: boolean;
  data: T | undefined;
}

export interface AsyncSectionProps<T> {
  query: AsyncSectionQuery<T>;
  /** Rendu pendant le chargement — y compris query désactivée (cf. `isPending`). */
  pending: ReactNode;
  /** Obligatoire : c'est la branche dont l'absence est le bug de MAN-244. */
  error: ReactNode;
  /** Optionnel — seulement pour les appelants qui décident du vide ici. */
  empty?: ReactNode | undefined;
  /** Requis pour que `empty` serve à quelque chose. */
  isEmpty?: ((data: T) => boolean) | undefined;
  children: (data: T) => ReactNode;
}

export function AsyncSection<T>({
  query,
  pending,
  error,
  empty,
  isEmpty,
  children,
}: AsyncSectionProps<T>) {
  // L'échec passe avant le chargement : sur un refetch en erreur, `isPending`
  // est faux et `isError` vrai — on doit montrer l'erreur, pas le contenu
  // périmé. Même ordre que le modèle déjà en place dans `GroupsSection`.
  if (query.isError) return <>{error}</>;
  if (query.isPending) return <>{pending}</>;

  // Ni en cours, ni en échec, mais sans données : violation de contrat côté
  // query. On retombe sur `pending`, jamais sur `empty` — déduire le vide d'une
  // absence d'information est exactement l'erreur que ce composant existe pour
  // empêcher.
  if (query.data === undefined) return <>{pending}</>;

  if (empty !== undefined && isEmpty?.(query.data)) return <>{empty}</>;

  return <>{children(query.data)}</>;
}
