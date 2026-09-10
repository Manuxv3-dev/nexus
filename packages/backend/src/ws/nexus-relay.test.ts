/**
 * Routage du relay Nexus — à qui un event est livré (cf. ticket 28514439).
 *
 * Le relay résolvait tout par `groupId` → membres COURANTS. Deux events y
 * perdaient leur destinataire :
 *
 * - **`member:removed`** : la personne retirée vient d'être supprimée de
 *   `group_members`, et `removeMember` invalide le cache de membership dans
 *   la foulée (cf. MAN-17). Elle est donc absente de la liste au moment du
 *   broadcast — alors que c'est précisément elle que l'event concerne. Un
 *   utilisateur éjecté ne l'apprenait jamais en direct : son app continuait
 *   d'afficher le groupe jusqu'au prochain fetch.
 * - **`notification:created`** : une notification est adressée à UNE personne
 *   (`payload.userId`). La router par groupe la livrait à tout le monde sauf,
 *   dans le cas du kick, à son destinataire. Et un `groupId` null — que le
 *   schéma autorise — la faisait purement et simplement jeter.
 *
 * Ces tests portent sur `resolveRecipients`, la fonction de routage, avec le
 * cache de membership mocké : pas de Redis, pas de Postgres.
 */
import { WsEventSchema, type WsEvent } from '@nexus/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv } from '../test/helpers.js';

vi.mock('./membership-cache.js', () => ({
  getGroupMembers: vi.fn(),
}));

import { getGroupMembers } from './membership-cache.js';

const mockedGetGroupMembers = vi.mocked(getGroupMembers);

const GROUP_ID = '11111111-1111-1111-1111-111111111111';
const ALICE = '22222222-2222-2222-2222-222222222222';
const BOB = '33333333-3333-3333-3333-333333333333';

// Le module sous test tire `core/logger`, qui valide l'env au chargement. Les
// imports ESM etant hoistes, poser l'env dans le corps du fichier arriverait
// trop tard : on charge donc le module dynamiquement, comme le fait deja
// `routes/home/home.test.ts` pour `buildServer`.
let resolveRecipients: (event: WsEvent) => Promise<string[]>;

beforeAll(async () => {
  setTestEnv();
  ({ resolveRecipients } = await import('./nexus-relay.js'));
});

beforeEach(() => {
  mockedGetGroupMembers.mockReset();
});

describe('resolveRecipients', () => {
  it('livre un event de groupe à ses membres courants', async () => {
    mockedGetGroupMembers.mockResolvedValue([ALICE, BOB]);
    const event = WsEventSchema.parse({
      type: 'event:created',
      groupId: GROUP_ID,
      timestamp: Date.now(),
      payload: { eventId: '44444444-4444-4444-4444-444444444444' },
    });

    await expect(resolveRecipients(event)).resolves.toEqual([ALICE, BOB]);
  });

  it('ajoute la personne retirée aux destinataires de `member:removed`', async () => {
    // Bob vient d'être éjecté : il n'est plus dans la liste des membres, et
    // c'est justement lui qui doit apprendre son éjection.
    mockedGetGroupMembers.mockResolvedValue([ALICE]);
    const event = WsEventSchema.parse({
      type: 'member:removed',
      groupId: GROUP_ID,
      timestamp: Date.now(),
      payload: { userId: BOB },
    });

    const recipients = await resolveRecipients(event);
    expect(recipients).toContain(BOB);
    expect(recipients).toContain(ALICE);
  });

  it('ne duplique pas le destinataire si un self-leave arrive avant le retrait', async () => {
    // Course possible : le cache de membership peut encore contenir le
    // partant. Deux `send` sur la même socket seraient inoffensifs, mais un
    // doublon dans la liste est le genre de détail qui se transforme en
    // double toast un jour.
    mockedGetGroupMembers.mockResolvedValue([ALICE, BOB]);
    const event = WsEventSchema.parse({
      type: 'member:removed',
      groupId: GROUP_ID,
      timestamp: Date.now(),
      payload: { userId: BOB },
    });

    const recipients = await resolveRecipients(event);
    expect(recipients.filter((id) => id === BOB)).toHaveLength(1);
  });

  it('livre une notification à son seul destinataire, pas à tout le groupe', async () => {
    // Une notification est adressée à une personne. La diffuser au groupe
    // apprenait à tout le monde qu'Alice avait reçu une notif, et de quel
    // kind — pour un effet client nul (chacun n'invalide que SA cloche).
    const event = WsEventSchema.parse({
      type: 'notification:created',
      groupId: GROUP_ID,
      timestamp: Date.now(),
      payload: {
        notificationId: '55555555-5555-5555-5555-555555555555',
        userId: ALICE,
        kind: 'expense_added',
      },
    });

    await expect(resolveRecipients(event)).resolves.toEqual([ALICE]);
    // Le groupe n'est même pas résolu : inutile.
    expect(mockedGetGroupMembers).not.toHaveBeenCalled();
  });

  it('livre une notification sans groupe, au lieu de la jeter', async () => {
    // `groupId` est nullable dans le schéma. Le routage par groupe faisait
    // tomber ces events-là dans la branche « event sans groupId, ignoré » :
    // ils n'étaient livrés à personne.
    const event = WsEventSchema.parse({
      type: 'notification:created',
      groupId: null,
      timestamp: Date.now(),
      payload: {
        notificationId: '66666666-6666-6666-6666-666666666666',
        userId: BOB,
        kind: 'event_reminder',
      },
    });

    await expect(resolveRecipients(event)).resolves.toEqual([BOB]);
  });

  it('ne livre rien pour un event de groupe sans groupId', async () => {
    const recipients = await resolveRecipients({
      type: 'event:created',
      groupId: null,
      timestamp: Date.now(),
      payload: {},
    } as unknown as WsEvent);

    expect(recipients).toEqual([]);
    expect(mockedGetGroupMembers).not.toHaveBeenCalled();
  });
});
