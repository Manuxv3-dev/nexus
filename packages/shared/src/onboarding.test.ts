import { describe, expect, it } from 'vitest';

import { OnboardingStepSchema } from './onboarding.js';

describe('OnboardingStepSchema', () => {
  it.each(['create_group', 'invite_link', 'connect_messaging', 'first_orga_item', 'public_share'])(
    'accepte %s',
    (step) => {
      expect(OnboardingStepSchema.parse(step)).toBe(step);
    },
  );

  it('rejette une valeur inconnue', () => {
    expect(() => OnboardingStepSchema.parse('unknown_step')).toThrow();
  });
});
