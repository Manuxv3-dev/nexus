/**
 * Le vidage du cache au changement d'identité authentifiée.
 *
 * Le `QueryClient` est un singleton de module, et sur desktop l'application
 * n'est pas rechargée entre deux sessions : sans ce hook, tout ce que le
 * compte précédent a mis en cache reste servable au suivant (cf. ticket
 * 10bc1096). Le test porte donc sur la seule chose qui compte — le cache est
 * vide après un départ — et sur son pendant, tout aussi important : il ne doit
 * PAS être vidé au démarrage à froid, quand l'identité passe simplement
 * d'« inconnue » à « connue ».
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import type * as ApiModule from './api';
import { useAuth, type User } from './auth';
import { useMessagingSessions } from './queries';
import { useResetCacheOnUserChange } from './useResetCacheOnUserChange';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

const USER_A: User = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'a@example.com',
  displayName: 'A',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home',
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const USER_B: User = {
  ...USER_A,
  id: '22222222-2222-2222-2222-222222222222',
  email: 'b@example.com',
  displayName: 'B',
};

/**
 * Une entrée de cache quelconque : ce hook est agnostique de la clé, c'est
 * tout son intérêt. Volontairement PAS la vraie clé du feed Home — la
 * recopier ici laisserait croire que le vidage ne concerne que lui.
 */
const CACHED_KEY = ['peu-importe', 'la-cle'];

function setUser(user: User | null): void {
  act(() => {
    useAuth.setState({ user, initializing: false });
  });
}

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function mount(client: QueryClient) {
  return renderHook(() => useResetCacheOnUserChange(), { wrapper: wrap(client) });
}

afterEach(() => {
  useAuth.setState({ user: null, initializing: true });
});

describe('useResetCacheOnUserChange', () => {
  it('vide le cache quand le compte se déconnecte', () => {
    const client = new QueryClient();
    setUser(USER_A);
    mount(client);
    client.setQueryData(CACHED_KEY, 'le feed de A');

    setUser(null);

    expect(client.getQueryData(CACHED_KEY)).toBeUndefined();
  });

  it("vide le cache quand un autre compte prend la main sans passer par l'écran d'auth", () => {
    const client = new QueryClient();
    setUser(USER_A);
    mount(client);
    client.setQueryData(CACHED_KEY, 'le feed de A');

    setUser(USER_B);

    expect(client.getQueryData(CACHED_KEY)).toBeUndefined();
  });

  it("ne vide rien au démarrage à froid — l'identité passe d'inconnue à connue", () => {
    // `init()` résout l'auth de façon asynchrone : au premier rendu il n'y a
    // pas encore d'utilisateur. Vider à cette transition-là jetterait ce que
    // le router a préchargé (`defaultPreload: 'intent'`) pour rien.
    const client = new QueryClient();
    setUser(null);
    mount(client);
    client.setQueryData(CACHED_KEY, 'prechargement legitime');

    setUser(USER_A);

    expect(client.getQueryData(CACHED_KEY)).toBe('prechargement legitime');
  });

  it("vide aussi à l'arrivée du compte suivant, pas seulement au départ du précédent", () => {
    // La fenêtre entre les deux n'est pas vide d'écritures : une mutation du
    // compte partant peut encore être en vol au moment du `clear()`, et son
    // `onSuccess` réécrire des données juste après. Ce second vidage la
    // rattrape. Dans le cas nominal il porte sur un cache déjà vide et ne
    // coûte rien.
    const client = new QueryClient();
    setUser(USER_A);
    mount(client);

    setUser(null);
    client.setQueryData(CACHED_KEY, 'ecriture de A, arrivee apres le clear');
    setUser(USER_B);

    expect(client.getQueryData(CACHED_KEY)).toBeUndefined();
  });

  it('ne vide rien tant que le même compte reste connecté', () => {
    // Un `setState` sur le store d'auth ne suffit pas : c'est le changement
    // d'IDENTITÉ qui déclenche, pas la mise à jour du profil. Sans ça, éditer
    // son nom ou son thème viderait tout le cache de l'application.
    const client = new QueryClient();
    setUser(USER_A);
    mount(client);
    client.setQueryData(CACHED_KEY, 'le feed de A');

    setUser({ ...USER_A, displayName: 'A, renomme' });

    expect(client.getQueryData(CACHED_KEY)).toBe('le feed de A');
  });

  it('un ecran remonte apres un changement de compte ne recoit pas les donnees du precedent', async () => {
    // Le seul test qui exerce l'invariante en conditions réelles : un vrai
    // hook de `queries.ts`, avec un observer monté, sur une clé qui ne porte
    // PAS de `userId` (`['me-messaging-sessions']`) — c'est-à-dire le cas
    // majoritaire du fichier, et le vrai périmètre du bug. Les tests
    // ci-dessus écrivent dans le cache à la main ; celui-ci passe par la
    // machinerie complète.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Monté avant l'écran et jamais démonté : c'est la position du Router, et
    // c'est ce qui permet au hook d'être encore là quand l'arbre authentifié
    // disparaît.
    setUser(USER_A);
    mount(client);

    mockedApi.mockResolvedValue({ sessions: [{ id: 'session-de-A', provider: 'discord' }] });
    const screenA = renderHook(() => useMessagingSessions(), { wrapper: wrap(client) });
    await waitFor(() => expect(screenA.result.current.isSuccess).toBe(true));
    expect(screenA.result.current.data).toHaveLength(1);
    screenA.unmount();

    setUser(null);
    setUser(USER_B);

    mockedApi.mockResolvedValue({ sessions: [] });
    const screenB = renderHook(() => useMessagingSessions(), { wrapper: wrap(client) });

    // Dès le premier rendu : la clé est la même que celle de A, donc sans le
    // vidage B lirait sa session Discord instantanément.
    expect(screenB.result.current.data).toBeUndefined();
    await waitFor(() => expect(screenB.result.current.isSuccess).toBe(true));
    expect(screenB.result.current.data).toHaveLength(0);
  });
});
