import { describe, expect, it } from 'vitest';

import { wcagContrast } from './wcag-contrast';

describe('wcagContrast', () => {
  it('noir sur blanc → ratio maximal de 21:1', () => {
    expect(wcagContrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('même couleur des deux côtés → ratio minimal de 1:1', () => {
    expect(wcagContrast('#2C2C2E', '#2C2C2E')).toBeCloseTo(1, 5);
  });

  it('est symétrique (ordre des arguments sans effet sur le ratio)', () => {
    const a = wcagContrast('#1C1C1E', '#FFFFFF');
    const b = wcagContrast('#FFFFFF', '#1C1C1E');
    expect(a).toBeCloseTo(b, 5);
  });

  it('compose une couleur rgba translucide sur le fond avant de calculer le contraste', () => {
    // Blanc à 62% sur fond noir ≈ gris moyen composé, pas blanc pur —
    // le ratio doit donc être significativement inférieur à noir/blanc (21:1).
    const ratio = wcagContrast('#000000', 'rgba(255,255,255,0.62)');
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(21);
  });

  it('rejette un format de couleur non supporté', () => {
    expect(() => wcagContrast('hsl(0, 0%, 0%)', '#FFFFFF')).toThrow();
  });
});
