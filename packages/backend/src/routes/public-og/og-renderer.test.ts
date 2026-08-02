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
import { beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv } from '../../test/helpers.js';

import type {
  fontsAvailable as FontsAvailableFn,
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
let renderTemplateToPng: typeof RenderFn;
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
  ({ fontsAvailable, renderTemplateToPng } = await import('./og-renderer.js'));
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
