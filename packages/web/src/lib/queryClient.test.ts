/**
 * La règle d'invalidation du feed Home portée par le `MutationCache`.
 *
 * Elle est globale et invisible depuis les call sites — c'est tout son
 * intérêt (aucune mutation future ne peut l'oublier), et c'est exactement ce
 * qui la rend facile à casser sans s'en rendre compte : la supprimer ne
 * produit aucune erreur, seulement une Home qui met jusqu'à 60 s à afficher ce
 * que l'utilisateur vient de créer (cf. ticket 0df77e79). Ces tests sont donc
 * le seul filet.
 *
 * Testé sur le client réel — pas sur un `new QueryClient()` de test — puisque
 * c'est la configuration de prod qui est l'objet du test.
 */
import { MutationObserver, type QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createQueryClient, HOME_QUERY_KEY } from './queryClient';

/**
 * La vraie clé du feed, **dérivée** de la constante partagée comme le fait
 * `useHomeFeed` — pas recopiée. Un test qui hardcode `['home', …]` resterait
 * vert après un renommage de la racine, alors même que la règle serait
 * devenue un no-op : il pinnerait le littéral, pas le lien.
 */
const HOME_FEED_KEY = [...HOME_QUERY_KEY, 'feed', '2026-09-14T00:00:00.000Z'];

/** Une query d'une autre famille, pour borner le rayon d'action de la règle. */
const EVENTS_KEY = ['events', 'group-1'];

/** Seed du cache Home, dans l'état « frais » qu'une mutation doit périmer. */
async function seedHomeFeed(client: QueryClient): Promise<void> {
  await client.fetchQuery({
    queryKey: HOME_FEED_KEY,
    queryFn: () => Promise.resolve('feed v1'),
  });
}

/** Joue une mutation via le client — donc via son `MutationCache`. */
async function runMutation(client: QueryClient, fn: () => Promise<unknown>): Promise<void> {
  const observer = new MutationObserver(client, { mutationFn: fn });
  await observer.mutate().catch(() => undefined);
}

describe('createQueryClient — invalidation du feed Home', () => {
  it('une mutation réussie périme le feed, malgré la clé paramétrée par semaine', async () => {
    // Le cœur du sujet : la règle invalide `['home']`, la query en cache est
    // `['home', 'feed', <weekStart>]`. C'est le matching par préfixe de
    // TanStack (`exact: false` par défaut) qui fait le lien — s'il tombait,
    // l'invalidation deviendrait un no-op silencieux.
    const client = createQueryClient();
    await seedHomeFeed(client);
    expect(client.getQueryState(HOME_FEED_KEY)?.isInvalidated).toBe(false);

    await runMutation(client, () => Promise.resolve('created'));

    expect(client.getQueryState(HOME_FEED_KEY)?.isInvalidated).toBe(true);
  });

  it('ne périme QUE le feed Home — pas tout le cache', async () => {
    // Sans cette assertion, remplacer `invalidateQueries({ queryKey })` par un
    // `invalidateQueries()` nu laisserait tous les autres tests verts, et
    // ferait refetcher events, sondages, dépenses et groupes à chaque clic.
    // C'est la régression de perf la plus plausible sur ce module.
    const client = createQueryClient();
    await seedHomeFeed(client);
    await client.fetchQuery({ queryKey: EVENTS_KEY, queryFn: () => Promise.resolve([]) });

    await runMutation(client, () => Promise.resolve('created'));

    expect(client.getQueryState(HOME_FEED_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(EVENTS_KEY)?.isInvalidated).toBe(false);
  });

  it("une mutation en échec ne périme rien — il n'y a rien de nouveau à montrer", async () => {
    const client = createQueryClient();
    await seedHomeFeed(client);

    await runMutation(client, () => Promise.reject(new Error('boom')));

    expect(client.getQueryState(HOME_FEED_KEY)?.isInvalidated).toBe(false);
  });

  it('conserve les défauts de queries sortis de main.tsx', () => {
    // Le passage de `main.tsx` à cette factory déplace ces trois réglages : en
    // perdre un ne casserait aucun test d'écran, ça changerait juste le
    // comportement de cache de toute l'app.
    const defaults = createQueryClient().getDefaultOptions().queries;
    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.retry).toBe(1);
  });
});
