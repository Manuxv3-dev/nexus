import { describe, expect, it } from 'vitest';

import { generateSlug } from './slug-generator.js';

describe('generateSlug', () => {
  it('génère un slug de 12 chars par défaut', () => {
    const slug = generateSlug();
    expect(slug).toHaveLength(12);
  });

  it('respecte la longueur demandée', () => {
    expect(generateSlug(8)).toHaveLength(8);
    expect(generateSlug(20)).toHaveLength(20);
  });

  it('produit uniquement des caractères base62', () => {
    const slug = generateSlug(50);
    expect(slug).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('produit des slugs différents à chaque appel', () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 100; i++) slugs.add(generateSlug());
    expect(slugs.size).toBe(100);
  });

  it('refuse les longueurs hors borne', () => {
    expect(() => generateSlug(3)).toThrow();
    expect(() => generateSlug(65)).toThrow();
  });
});
