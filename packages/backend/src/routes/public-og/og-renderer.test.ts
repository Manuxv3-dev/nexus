/**
 * Régression MAN-36 : contrairement à `public-og.test.ts` (qui mocke
 * `og-renderer.js` en entier), ce test exerce le vrai pipeline Satori +
 * @resvg/resvg-js avec les fonts réelles depuis `assets/fonts/`, sans mock.
 *
 * C'est le rendu réel qui plantait pour **tous les types** de ressource
 * (`TypeError: Cannot read properties of undefined (reading '256')` dans
 * `parseFvarAxis`, `@shuding/opentype.js` échouant à parser la table `fvar`
 * de la police variable Inter, avant même de toucher un template) — pas la
 * résolution de ressource, déjà couverte ailleurs. D'où la couverture des 5
 * types ici plutôt qu'un seul.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestEnv } from '../../test/helpers.js';

import type {
  fontsAvailable as FontsAvailableFn,
  ogCacheKey as OgCacheKeyFn,
  renderOgPng as RenderOgPngFn,
  renderTemplateToPng as RenderFn,
} from './og-renderer.js';
import type {
  eventTemplate as EventTemplateFn,
  expenseTemplate as ExpenseTemplateFn,
  listTemplate as ListTemplateFn,
  OgTemplate,
  pollTemplate as PollTemplateFn,
  todoTemplate as TodoTemplateFn,
} from './templates.js';

let fontsAvailable: typeof FontsAvailableFn;
let ogCacheKey: typeof OgCacheKeyFn;
let renderOgPng: typeof RenderOgPngFn;
let renderTemplateToPng: typeof RenderFn;

// Double Redis en mémoire : la seule chose que `renderOgPng` lui demande
// (`getBuffer` / `set`). Pas de Redis sur cette machine, et le sujet est la
// CLÉ, pas le transport.
const fakeRedis = {
  store: new Map<string, Buffer>(),
  getBuffer: vi.fn((key: string) => Promise.resolve(fakeRedis.store.get(key) ?? null)),
  set: vi.fn((key: string, value: Buffer) => {
    fakeRedis.store.set(key, value);
    return Promise.resolve('OK');
  }),
};
vi.mock('../../core/redis.js', () => ({ getRedis: () => fakeRedis }));
let eventTemplate: typeof EventTemplateFn;
let pollTemplate: typeof PollTemplateFn;
let expenseTemplate: typeof ExpenseTemplateFn;
let todoTemplate: typeof TodoTemplateFn;
let listTemplate: typeof ListTemplateFn;

beforeAll(async () => {
  // `og-renderer.js` importe `core/logger.js`, qui valide les env vars au
  // chargement du module — on doit donc setTestEnv() avant de l'importer.
  setTestEnv();
  ({ eventTemplate, pollTemplate, expenseTemplate, todoTemplate, listTemplate } =
    await import('./templates.js'));
  ({ fontsAvailable, ogCacheKey, renderOgPng, renderTemplateToPng } =
    await import('./og-renderer.js'));
});

describe('og-renderer — renderOgPng contourne le cache quand le rendu change (163de7bb)', () => {
  // La moitié CLÉ de la preuve (la moitié ROUTE est dans `public-og.test.ts`,
  // où le renderer est mocké) : même slug, décompte différent → deux clés,
  // deux rendus ; même contenu → un hit, pas de rendu. Rendu réel, comme les
  // cas MAN-36 ci-dessous.
  const input = (yes: number) =>
    eventTemplate({
      title: 'Soirée chez Manu',
      startsAt: '2026-08-15T18:00:00.000Z',
      location: 'Chez Manu',
      rsvpCounts: { yes, maybe: 1, no: 0 },
    });

  it('rend à nouveau quand une valeur dessinée change, et sert le cache sinon', async () => {
    fakeRedis.store.clear();
    fakeRedis.set.mockClear();
    fakeRedis.getBuffer.mockClear();

    const first = await renderOgPng({ type: 'event', slug: 'cache-key', template: input(5) });
    expect(fakeRedis.set).toHaveBeenCalledTimes(1);
    const firstKey = fakeRedis.set.mock.calls[0]?.[0];

    // Un membre part : « 4 oui » — `updatedAt` n'a pas bougé, et pourtant.
    const departed = await renderOgPng({ type: 'event', slug: 'cache-key', template: input(4) });
    expect(fakeRedis.set).toHaveBeenCalledTimes(2);
    const secondKey = fakeRedis.set.mock.calls[1]?.[0];
    expect(secondKey).not.toBe(firstKey);
    expect(departed.equals(first)).toBe(false);

    // Retour à « 5 oui » (ré-invitation, RSVP) : la clé existe déjà, on ne
    // rend pas — et c'est bien le premier PNG qui ressort.
    const again = await renderOgPng({ type: 'event', slug: 'cache-key', template: input(5) });
    expect(fakeRedis.set).toHaveBeenCalledTimes(2);
    expect(again.equals(first)).toBe(true);
  });
});

describe('og-renderer — clé de cache dérivée du contenu rendu (163de7bb)', () => {
  // La clé versionnait sur `updatedAt`. Tout ce qui change le RENDU sans
  // toucher la ligne — le départ d'un membre retire son RSVP du décompte
  // sans toucher `events.updated_at` — laissait le PNG périmé 30 jours. La
  // clé dérive maintenant du template lui-même : si ce qui est dessiné
  // change, la clé change, quelle qu'en soit la raison.
  const base = () =>
    eventTemplate({
      title: 'Soirée chez Manu',
      startsAt: '2026-08-15T18:00:00.000Z',
      location: 'Chez Manu',
      rsvpCounts: { yes: 3, maybe: 1, no: 0 },
    });

  it('est stable pour un contenu identique — un template reconstruit à l’identique retombe dessus', () => {
    expect(ogCacheKey('event', 'abc123', base())).toBe(ogCacheKey('event', 'abc123', base()));
    expect(ogCacheKey('event', 'abc123', base())).toMatch(/^og:event:abc123:[0-9a-f]{16}$/);
  });

  it('change dès qu’une valeur rendue change — ici un RSVP en moins', () => {
    const departed = eventTemplate({
      title: 'Soirée chez Manu',
      startsAt: '2026-08-15T18:00:00.000Z',
      location: 'Chez Manu',
      rsvpCounts: { yes: 2, maybe: 1, no: 0 },
    });
    expect(ogCacheKey('event', 'abc123', departed)).not.toBe(ogCacheKey('event', 'abc123', base()));
  });

  it('sépare les ressources — même contenu, autre slug ou autre type', () => {
    expect(ogCacheKey('event', 'abc123', base())).not.toBe(ogCacheKey('event', 'xyz789', base()));
    expect(ogCacheKey('event', 'abc123', base())).not.toBe(ogCacheKey('poll', 'abc123', base()));
  });
});

describe('og-renderer (rendu réel, non mocké)', () => {
  it('fontsAvailable() résout true avec les fonts committées', async () => {
    expect(await fontsAvailable()).toBe(true);
  });

  const cases: [string, () => OgTemplate][] = [
    [
      'event',
      () =>
        eventTemplate({
          title: 'Soirée chez Manu',
          startsAt: '2026-08-15T18:00:00.000Z',
          location: 'Chez Manu',
          rsvpCounts: { yes: 3, maybe: 1, no: 0 },
        }),
    ],
    [
      'poll',
      () =>
        pollTemplate({
          question: 'On mange où ?',
          multi: false,
          options: [
            { label: 'Pizza', voteCount: 2 },
            { label: 'Sushi', voteCount: 1 },
          ],
          totalVotes: 3,
          closesAt: null,
        }),
    ],
    [
      'expense',
      () =>
        expenseTemplate({
          description: 'Courses',
          amountCents: 4250,
          currency: 'EUR',
          paidByName: 'Manu',
          participantCount: 3,
        }),
    ],
    ['todo', () => todoTemplate({ title: 'Qui amène quoi', itemsTotal: 5, itemsDone: 2 })],
    ['list', () => listTemplate({ title: 'Liste de courses', itemsTotal: 8, itemsDone: 8 })],
  ];

  it.each(cases)(
    'rend le template %s en PNG valide sans planter (régression MAN-36)',
    async (_type, buildTemplate) => {
      const png = await renderTemplateToPng(buildTemplate());

      expect(Buffer.isBuffer(png)).toBe(true);
      expect(png.length).toBeGreaterThan(0);
      // Signature PNG : 89 50 4E 47 0D 0A 1A 0A
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      // Chunk IHDR (bytes 8-24) : longueur(4) + "IHDR"(4) + width(4) + height(4),
      // tout en big-endian — vérifie le format 1200×630 attendu par ADR-018.
      expect(png.toString('ascii', 12, 16)).toBe('IHDR');
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(630);
    },
  );
});
