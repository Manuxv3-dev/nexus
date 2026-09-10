/**
 * `logout()` désabonne l'appareil du push (cf. ticket 35c39b3a).
 *
 * Sur une machine partagée, l'abonnement push reste attaché au compte qui l'a
 * activé : `push_subscriptions` porte un index unique sur `endpoint` seul, et
 * seul un `subscribeToPush()` — déclenché uniquement par le toggle des
 * Réglages — réattribue la ligne. Rien ne le déclenche à la connexion. Les
 * notifications de A, **avec aperçu**, continuaient donc d'arriver sur la
 * machine que B utilise, et ce même application fermée : c'est le service
 * worker qui les reçoit.
 *
 * **L'ordre est le fond du test.** `DELETE /push/subscribe` ne supprime la
 * ligne que si elle appartient au `userId` appelant : le désabonnement doit
 * donc partir pendant que le token de A est encore posé. Le faire après —
 * dans un effet sur changement d'identité, comme pour le vidage du cache de
 * `10bc1096` — enverrait un DELETE non authentifié, et la ligne resterait.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccessToken, setAccessToken } from './api';
import type * as ApiModule from './api';
import { useAuth } from './auth';
import { unsubscribeFromPush } from './push';
import type * as TauriModule from './tauri';

// `vi.mock` et `vi.hoisted` sont remontes au-dessus des imports par vitest :
// les declarer apres eux, comme le fait le reste du repo, garde le bloc
// d'imports d'un seul tenant.
const { unsubscribeCalls } = vi.hoisted(() => ({
  unsubscribeCalls: { current: [] as (string | null)[] },
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn().mockResolvedValue({}) };
});

vi.mock('./push', () => ({
  unsubscribeFromPush: vi.fn(async () => {
    // On enregistre l'etat du token AU MOMENT de l'appel : c'est lui qui dit
    // si le DELETE partira authentifie.
    const { getAccessToken: read } = await import('./api');
    unsubscribeCalls.current.push(read());
  }),
}));

// `./api` consomme d'autres exports de `./tauri` : on part du module reel et
// on n'override que ce dont le test a besoin.
vi.mock('./tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, isTauri: () => false };
});

beforeEach(() => {
  unsubscribeCalls.current = [];
  vi.mocked(unsubscribeFromPush).mockClear();
  setAccessToken('token-de-A');
  useAuth.setState({ user: null, initializing: false });
});

describe('logout — désabonnement push', () => {
  it("désabonne l'appareil, et le fait tant que le token est encore posé", async () => {
    await useAuth.getState().logout();

    expect(unsubscribeFromPush).toHaveBeenCalledTimes(1);
    // Le token était encore là : le DELETE part authentifié, donc la ligne de
    // A est bien supprimée. C'est toute la subtilité du ticket.
    expect(unsubscribeCalls.current).toEqual(['token-de-A']);
    // Et après, la session est bien fermée.
    expect(getAccessToken()).toBeNull();
  });

  it('se déconnecte quand même si le désabonnement échoue', async () => {
    vi.mocked(unsubscribeFromPush).mockRejectedValueOnce(new Error('service worker absent'));

    await expect(useAuth.getState().logout()).resolves.toBeUndefined();

    // Un push cassé ne doit jamais retenir quelqu'un connecté : c'est le
    // sens du best-effort.
    expect(getAccessToken()).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });
});
