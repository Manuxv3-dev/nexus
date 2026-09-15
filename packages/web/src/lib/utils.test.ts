/**
 * `formatMemberCount` — pluralisation FR du total de membres (ticket
 * 8a080863, revue #113). Fonction pure : pas de mock nécessaire.
 */
import { describe, expect, it } from 'vitest';

import { formatMemberCount } from './utils';

describe('formatMemberCount', () => {
  it('reste au singulier pour 1', () => {
    expect(formatMemberCount(1)).toBe('1 membre');
  });

  it('passe au pluriel au-delà de 1', () => {
    expect(formatMemberCount(2)).toBe('2 membres');
    expect(formatMemberCount(5)).toBe('5 membres');
  });

  it('reste au singulier pour 0 (même règle que GroupHomeDashboard : > 1, pas >= 2)', () => {
    // Un groupe à 0 membre est en théorie inatteignable (le viewer en est
    // membre), mais le mapping ne doit pas planter dessus — et FR dit
    // "0 membre", pas "0 membres".
    expect(formatMemberCount(0)).toBe('0 membre');
  });
});
