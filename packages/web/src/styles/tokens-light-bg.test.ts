/**
 * Fond light — identité propre — MAN-128 (Phase 2 de MAN-126), puis MAN-129
 * (retour explicite de Manu : blade et pages inversés après déploiement).
 *
 * Change purement visuel : la vraie preuve reste la preview navigateur
 * (cf. Acceptance Criteria du ticket). Ce fichier prouve ce qui est
 * programmatiquement vérifiable, même structure que tokens-dark-bg.test.ts
 * (MAN-127) :
 *   - les valeurs de `--nx-bg`/`--nx-grid-line`/`--nx-glass-bg` existent bien
 *     dans le bloc light de tokens.css
 *   - le contraste texte/fond reste au-dessus du seuil AA (4.5:1)
 *   - le blade (`--nx-glass-bg`) est mesurablement plus foncé que les pages
 *     (`--nx-bg`) — cf. MAN-129, demande explicite de Manu
 *   - le contraste fond/surfaces élevées ne régresse pas par rapport à
 *     `PRE_MAN128_LIGHT_BG` (`#E8E8E8`, l'état d'avant toute cette
 *     initiative) — MAN-129 échange `--nx-bg`/`--nx-glass-bg`, ce qui
 *     redescend ce ratio depuis le pic atteint par MAN-128 (~1.33:1) vers
 *     ~1.18:1, mais reste au-dessus de l'état jamais éprouvé pré-MAN-128
 */
import { describe, expect, it } from 'vitest';

import { luminanceOf, wcagContrast } from '../lib/wcag-contrast';
import { readCssToken } from '../test/read-css-token';

// Valeur en prod avant MAN-128 — référence de non-régression pour
// fond/surfaces élevées (pas la valeur intermédiaire MAN-128).
const PRE_MAN128_LIGHT_BG = '#E8E8E8';

describe('tokens light — identité propre (MAN-128, MAN-129)', () => {
  const fg = readCssToken('light', 'nx-fg');
  const fgMuted = readCssToken('light', 'nx-fg-muted');
  const surface = readCssToken('light', 'nx-surface');
  const elevated = readCssToken('light', 'nx-elevated');
  const raised = readCssToken('light', 'nx-raised');
  const bg = readCssToken('light', 'nx-bg');
  const gridLine = readCssToken('light', 'nx-grid-line');
  const glassBg = readCssToken('light', 'nx-glass-bg');

  it('le blade (--nx-glass-bg) est plus foncé que les pages (--nx-bg) — cf. MAN-129', () => {
    expect(luminanceOf(glassBg, bg)).toBeLessThan(luminanceOf(bg));
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
    const before = wcagContrast(PRE_MAN128_LIGHT_BG, surface);
    const after = wcagContrast(bg, surface);
    expect(after).toBeGreaterThan(before);
  });

  it('contraste fond/surface élevée est amélioré par rapport à la valeur historique', () => {
    const before = wcagContrast(PRE_MAN128_LIGHT_BG, elevated);
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
