/**
 * Fond dark — MAN-127 (Phase 1 de MAN-126) puis MAN-131 (retour "moins
 * sombre" + halo, après retour de Manu sur le rendu déployé de MAN-127).
 *
 * Change purement visuel : la vraie preuve reste la preview navigateur
 * (cf. Acceptance Criteria du ticket). Ce fichier prouve ce qui est
 * programmatiquement vérifiable :
 *   - les valeurs de `--nx-bg`/`--nx-grid-line`/`--nx-halo` existent bien
 *     dans le bloc dark de tokens.css (lu directement — Vitest tourne avec
 *     `css: false`, aucune feuille de style n'est chargée dans jsdom)
 *   - le contraste texte/fond reste au-dessus du seuil AA (4.5:1)
 *   - le contraste fond/surfaces élevées ne régresse pas par rapport à
 *     `PRE_MAN127_DARK_BG` (`#1C1C1E`, la valeur en prod avant toute cette
 *     initiative) — un seuil absolu de 3:1 (WCAG 1.4.11) n'est pas
 *     atteignable ici sans toucher aux surfaces elles-mêmes (hors périmètre,
 *     cf. hiérarchie Apple grouped-dark systemGray6→3 déjà en place)
 *
 * MAN-131 fait revenir `--nx-bg` exactement à `#1C1C1E` (Manu : le
 * `#0A0A0A` de MAN-127 était trop sombre) — le contraste fond/surface
 * redescend donc de ~1.42:1 (MAN-127) à ~1.22:1, mais reste identique à
 * l'état pré-MAN-127 qui tournait en prod depuis longtemps : pas une
 * régression sous un état jamais éprouvé, juste l'abandon d'une amélioration
 * ponctuelle au profit du halo (compensation visuelle voulue par Manu).
 */
import { describe, expect, it } from 'vitest';

import { luminanceOf, wcagContrast } from '../lib/wcag-contrast';
import { readCssToken } from '../test/read-css-token';

// Valeur en prod avant MAN-127 — et de nouveau la valeur courante depuis
// MAN-131. Sert de référence de non-régression pour fond/surfaces élevées.
const PRE_MAN127_DARK_BG = '#1C1C1E';

describe('tokens dark — fond + halo (MAN-127, MAN-131)', () => {
  const fg = readCssToken('dark', 'nx-fg');
  const fgMuted = readCssToken('dark', 'nx-fg-muted');
  const surface = readCssToken('dark', 'nx-surface');
  const elevated = readCssToken('dark', 'nx-elevated');
  const bg = readCssToken('dark', 'nx-bg');
  const gridLine = readCssToken('dark', 'nx-grid-line');
  const halo = readCssToken('dark', 'nx-halo');

  it('--nx-halo (dark) est défini', () => {
    expect(halo).toBeTruthy();
  });

  it('--nx-grid-line (dark) est défini', () => {
    expect(gridLine).toBeTruthy();
  });

  it(
    '--nx-grid-line (dark) éclaircit le fond (lignes claires sur canvas sombre, pas ' +
      "l'inverse — cf. MAN-128 : un copier-coller de la valeur light, sombre, laisserait " +
      'une grille quasi invisible sans faire échouer les autres assertions)',
    () => {
      expect(luminanceOf(gridLine, bg)).toBeGreaterThan(luminanceOf(bg));
    },
  );

  it('contraste fond/texte (nx-fg) conforme au seuil AA (4.5:1)', () => {
    expect(wcagContrast(bg, fg)).toBeGreaterThanOrEqual(4.5);
  });

  it('contraste fond/texte atténué (nx-fg-muted) conforme au seuil AA (4.5:1)', () => {
    expect(wcagContrast(bg, fgMuted)).toBeGreaterThanOrEqual(4.5);
  });

  it("contraste fond/surface ne régresse pas par rapport à l'état pré-MAN-127", () => {
    const before = wcagContrast(PRE_MAN127_DARK_BG, surface);
    const after = wcagContrast(bg, surface);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("contraste fond/surface élevée ne régresse pas par rapport à l'état pré-MAN-127", () => {
    const before = wcagContrast(PRE_MAN127_DARK_BG, elevated);
    const after = wcagContrast(bg, elevated);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it(
    "préserve la hiérarchie d'élévation (fond < surface < élevé) — le ratio de " +
      'contraste seul est symétrique et ne suffit pas à prouver ça (un fond bien plus ' +
      'clair que la surface passerait aussi les tests de non-régression ci-dessus)',
    () => {
      const bgLuminance = luminanceOf(bg);
      const surfaceLuminance = luminanceOf(surface);
      const elevatedLuminance = luminanceOf(elevated);

      expect(bgLuminance).toBeLessThan(surfaceLuminance);
      expect(surfaceLuminance).toBeLessThan(elevatedLuminance);
    },
  );
});
