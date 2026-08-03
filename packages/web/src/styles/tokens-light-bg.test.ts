/**
 * Fond light — identité propre — MAN-128 (Phase 2 de MAN-126).
 *
 * Change purement visuel : la vraie preuve reste la preview navigateur
 * (cf. Acceptance Criteria du ticket). Ce fichier prouve ce qui est
 * programmatiquement vérifiable, même structure que tokens-dark-bg.test.ts
 * (MAN-127) :
 *   - les nouvelles valeurs de `--nx-bg`/`--nx-grid-line` existent bien
 *     dans le bloc light de tokens.css
 *   - le contraste texte/fond reste au-dessus du seuil AA (4.5:1)
 *   - le contraste fond/surfaces élevées ne régresse pas par rapport à la
 *     valeur historique (`#E8E8E8`) — comme pour le dark (MAN-127), un seuil
 *     absolu de 3:1 (WCAG 1.4.11) n'est pas atteignable ici sans toucher aux
 *     surfaces elles-mêmes (fixées à #F0F0F0, hors périmètre) : assombrir le
 *     fond au-delà de #D2D2D2 pour s'en rapprocher casserait le seuil AA de
 *     `--nx-fg-muted` (opacité 62%, cf. commentaire dans tokens.css) —
 *     contrainte symétrique déjà documentée côté dark.
 */
import { describe, expect, it } from 'vitest';

import { luminanceOf, wcagContrast } from '../lib/wcag-contrast';
import { readCssToken } from '../test/read-css-token';

// Valeur historique de --nx-bg (light) avant MAN-128 — sert de référence
// pour la non-régression du contraste fond/surfaces élevées.
const HISTORICAL_LIGHT_BG = '#E8E8E8';

describe('tokens light — identité propre (MAN-128)', () => {
  const fg = readCssToken('light', 'nx-fg');
  const fgMuted = readCssToken('light', 'nx-fg-muted');
  const surface = readCssToken('light', 'nx-surface');
  const elevated = readCssToken('light', 'nx-elevated');
  const raised = readCssToken('light', 'nx-raised');
  const bg = readCssToken('light', 'nx-bg');
  const gridLine = readCssToken('light', 'nx-grid-line');

  it('le nouveau --nx-bg (light) diffère de la valeur historique', () => {
    expect(bg.toLowerCase()).not.toBe(HISTORICAL_LIGHT_BG.toLowerCase());
  });

  it('--nx-grid-line (light) est défini', () => {
    expect(gridLine).toBeTruthy();
  });

  it(
    '--nx-grid-line (light) assombrit le fond (lignes sombres sur canvas clair, pas ' +
      "l'inverse — un copier-coller de la valeur dark, claire, laisserait une grille " +
      'quasi invisible sans faire échouer les autres assertions)',
    () => {
      expect(luminanceOf(gridLine, bg)).toBeLessThan(luminanceOf(bg));
    },
  );

  it('contraste fond/texte (nx-fg) conforme au seuil AA (4.5:1)', () => {
    expect(wcagContrast(bg, fg)).toBeGreaterThanOrEqual(4.5);
  });

  it('contraste fond/texte atténué (nx-fg-muted) conforme au seuil AA (4.5:1)', () => {
    expect(wcagContrast(bg, fgMuted)).toBeGreaterThanOrEqual(4.5);
  });

  it('contraste fond/surface est amélioré par rapport à la valeur historique', () => {
    const before = wcagContrast(HISTORICAL_LIGHT_BG, surface);
    const after = wcagContrast(bg, surface);
    expect(after).toBeGreaterThan(before);
  });

  it('contraste fond/surface élevée est amélioré par rapport à la valeur historique', () => {
    const before = wcagContrast(HISTORICAL_LIGHT_BG, elevated);
    const after = wcagContrast(bg, elevated);
    expect(after).toBeGreaterThan(before);
  });

  it(
    "préserve la hiérarchie d'élévation (fond < surface/élevé < raised) — même logique " +
      "que le dark (MAN-127) : l'élévation éclaircit, le canvas reste le tier le plus " +
      'sombre (recessed), pas un simple négatif du dark. surface et elevated valent la ' +
      "même couleur en light aujourd'hui (pas de tier distinct) — surface < raised est " +
      "la seule comparaison stricte disponible pour prouver l'ordre au-delà du canvas.",
    () => {
      const bgLuminance = luminanceOf(bg);
      const surfaceLuminance = luminanceOf(surface);
      const elevatedLuminance = luminanceOf(elevated);
      const raisedLuminance = luminanceOf(raised);

      expect(bgLuminance).toBeLessThan(surfaceLuminance);
      expect(bgLuminance).toBeLessThan(elevatedLuminance);
      expect(surfaceLuminance).toBeLessThan(raisedLuminance);
    },
  );
});
