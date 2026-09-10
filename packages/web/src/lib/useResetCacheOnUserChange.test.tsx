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
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAuth, type User } from './auth';
import { useResetCacheOnUserChange } from './useResetCacheOnUserChange';

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

/** Ce qu'un compte laisse derrière lui : le feed Home, et le reste. */
const CACHED_KEY = ['home', 'feed', '2026-09-14T00:00:00.000Z'];

function setUser(user: User | null): void {
  act(() => {
    useAuth.setState({ user, initializing: false });
  });
}

function mount(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useResetCacheOnUserChange(), { wrapper });
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
});
