import { describe, expect, it } from 'vitest';

import { connectionStore, type WsConnection } from './connection-store.js';

const fakeSocket = {} as WsConnection['socket'];

function makeConn(userId: string, groupIds: string[] = []): WsConnection {
  return { socket: fakeSocket, userId, groupIds };
}

describe('connectionStore', () => {
  it('ajoute, retrouve et retire des connexions', () => {
    connectionStore.clear();

    const a = makeConn('user-a', ['g1']);
    connectionStore.add(a);

    expect(connectionStore.size()).toBe(1);
    expect(connectionStore.getByUser('user-a')).toHaveLength(1);
    expect(connectionStore.onlineUserIds()).toEqual(['user-a']);

    const wentOffline = connectionStore.remove(a);
    expect(wentOffline).toBe(true);
    expect(connectionStore.size()).toBe(0);
  });

  it("retourne false en remove si l'user a encore d'autres sockets", () => {
    connectionStore.clear();

    const a1 = makeConn('user-a');
    const a2 = makeConn('user-a');
    connectionStore.add(a1);
    connectionStore.add(a2);

    const wentOffline = connectionStore.remove(a1);
    expect(wentOffline).toBe(false);
    expect(connectionStore.getByUser('user-a')).toHaveLength(1);

    const finalOffline = connectionStore.remove(a2);
    expect(finalOffline).toBe(true);
  });
});
