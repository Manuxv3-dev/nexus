/**
 * useKillerFeaturesWs — côté client du contrat WS.
 *
 * Ce fichier couvre la réception de `member:role_updated` (MAN-180) : le
 * backend publie l'event, encore faut-il qu'un client l'exploite. On monte
 * le hook avec `useWs` mocké (pas de socket réelle), on lui pousse un event
 * **validé par `WsEventSchema`** — donc exactement la forme qui transite sur
 * le fil — et on vérifie l'effet observable : la query `group-members` du
 * groupe concerné est invalidée, celle d'un autre groupe non.
 */
import { WsEventSchema, type WsEvent } from '@nexus/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capturedHandler } = vi.hoisted(() => ({
  capturedHandler: { current: null as ((event: WsEvent) => void) | null },
}));

vi.mock('./ws', () => ({
  useWs: (opts: { onEvent: (event: WsEvent) => void }) => {
    capturedHandler.current = opts.onEvent;
    return { status: 'open' as const };
  },
}));

import { useKillerFeaturesWs } from './useKillerFeaturesWs';

const GROUP_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_GROUP_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';
const NEW_OWNER_ID = '55555555-5555-5555-5555-555555555555';

function mountHook() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  renderHook(() => useKillerFeaturesWs(), { wrapper });
  return qc;
}

describe('useKillerFeaturesWs — member:role_updated (MAN-180)', () => {
  beforeEach(() => {
    capturedHandler.current = null;
  });

  it('test_member_role_updated_invalidates_group_members_query', () => {
    const qc = mountHook();
    qc.setQueryData(['group-members', GROUP_ID], []);
    qc.setQueryData(['group-members', OTHER_GROUP_ID], []);
    expect(qc.getQueryState(['group-members', GROUP_ID])?.isInvalidated).toBe(false);

    // Forme exacte publiée par le backend, repassée par le schema partagé.
    const event = WsEventSchema.parse({
      type: 'member:role_updated',
      groupId: GROUP_ID,
      timestamp: Date.now(),
      payload: { userId: USER_ID, newRole: 'admin' },
    });

    const handler = capturedHandler.current;
    if (!handler) throw new Error('useWs n’a pas reçu de handler onEvent');
    handler(event);

    expect(qc.getQueryState(['group-members', GROUP_ID])?.isInvalidated).toBe(true);
    // Anti-fuite de cache : le groupe voisin n'est pas touché.
    expect(qc.getQueryState(['group-members', OTHER_GROUP_ID])?.isInvalidated).toBe(false);
  });

  it('test_ownership_transferred_invalidates_group_members_query — MAN-181', () => {
    const qc = mountHook();
    qc.setQueryData(['group-members', GROUP_ID], []);
    qc.setQueryData(['group-members', OTHER_GROUP_ID], []);
    expect(qc.getQueryState(['group-members', GROUP_ID])?.isInvalidated).toBe(false);

    // Forme exacte publiée par le backend, repassée par le schema partagé.
    const event = WsEventSchema.parse({
      type: 'group:ownership_transferred',
      groupId: GROUP_ID,
      timestamp: Date.now(),
      payload: { previousOwnerUserId: USER_ID, newOwnerUserId: NEW_OWNER_ID },
    });

    const handler = capturedHandler.current;
    if (!handler) throw new Error('useWs n’a pas reçu de handler onEvent');
    handler(event);

    expect(qc.getQueryState(['group-members', GROUP_ID])?.isInvalidated).toBe(true);
    // Anti-fuite de cache : le groupe voisin n'est pas touché.
    expect(qc.getQueryState(['group-members', OTHER_GROUP_ID])?.isInvalidated).toBe(false);
  });

  it('test_member_removed_invalidates_group_members_query — MAN-182', () => {
    const qc = mountHook();
    qc.setQueryData(['group-members', GROUP_ID], []);
    qc.setQueryData(['group-members', OTHER_GROUP_ID], []);
    expect(qc.getQueryState(['group-members', GROUP_ID])?.isInvalidated).toBe(false);

    // Forme exacte publiée par le backend, repassée par le schema partagé.
    const event = WsEventSchema.parse({
      type: 'member:removed',
      groupId: GROUP_ID,
      timestamp: Date.now(),
      payload: { userId: USER_ID },
    });

    const handler = capturedHandler.current;
    if (!handler) throw new Error('useWs n’a pas reçu de handler onEvent');
    handler(event);

    expect(qc.getQueryState(['group-members', GROUP_ID])?.isInvalidated).toBe(true);
    // Anti-fuite de cache : le groupe voisin n'est pas touché.
    expect(qc.getQueryState(['group-members', OTHER_GROUP_ID])?.isInvalidated).toBe(false);
  });

  it('ignore sans planter un type d’event inconnu du client (compat ascendante)', () => {
    const qc = mountHook();
    qc.setQueryData(['group-members', GROUP_ID], []);

    const handler = capturedHandler.current;
    if (!handler) throw new Error('useWs n’a pas reçu de handler onEvent');
    // Cast délibéré : simule un event ajouté par un backend plus récent
    // que ce client. Le `default:` du switch doit l'absorber silencieusement.
    expect(() =>
      handler({
        type: 'member:something_new',
        groupId: GROUP_ID,
        timestamp: Date.now(),
        payload: {},
      } as unknown as WsEvent),
    ).not.toThrow();
    expect(qc.getQueryState(['group-members', GROUP_ID])?.isInvalidated).toBe(false);
  });
});
