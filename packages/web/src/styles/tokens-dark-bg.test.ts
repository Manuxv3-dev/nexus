/**
 * Fond dark aligné landing — MAN-127 (Phase 1 de MAN-126).
 *
 * Change purement visuel : la vraie preuve reste la preview navigateur
 * (cf. Acceptance Criteria du ticket). Ce fichier prouve ce qui est
 * programmatiquement vérifiable :
 *   - les nouvelles valeurs de `--nx-bg`/`--nx-grid-line` existent bien
 *     dans le bloc dark de tokens.css (lu directement — Vitest tourne avec
 *     `css: false`, aucune feuille de style n'est chargée dans jsdom)
 *   - le contraste texte/fond reste au-dessus du seuil AA (4.5:1)
 *   - le contraste fond/surfaces élevées ne régresse pas par rapport à la
 *     valeur historique (`#1C1C1E`) — un seuil absolu de 3:1 (WCAG 1.4.11)
 *     n'est pas atteignable ici sans toucher aux surfaces elles-mêmes
 *     (hors périmètre de ce ticket, cf. hiérarchie Apple grouped-dark
 *     systemGray6→3 déjà en place), donc le critère réel du ticket
 *     ("reste au moins aussi net qu'aujourd'hui") est une non-régression,
 *     pas un seuil absolu.
 */
import { describe, expect, it } from 'vitest';

import { luminanceOf, wcagContrast } from '../lib/wcag-contrast';
import { readCssToken } from '../test/read-css-token';

// Valeur historique de --nx-bg (dark) avant MAN-127 — sert de référence pour
// la non-régression du contraste fond/surfaces élevées.
const HISTORICAL_DARK_BG = '#1C1C1E';

describe('tokens dark — fond aligné landing (MAN-127)', () => {
  const fg = readCssToken('dark', 'nx-fg');
  const fgMuted = readCssToken('dark', 'nx-fg-muted');
  const surface = readCssToken('dark', 'nx-surface');
  const elevated = readCssToken('dark', 'nx-elevated');
  const bg = readCssToken('dark', 'nx-bg');
  const gridLine = readCssToken('dark', 'nx-grid-line');

  it('le nouveau --nx-bg (dark) diffère de la valeur historique', () => {
    expect(bg.toLowerCase()).not.toBe(HISTORICAL_DARK_BG.toLowerCase());
  });

  it('--nx-grid-line (dark) est défini', () => {
    expect(gridLine).toBeTruthy();
  });

  it('contraste fond/texte (nx-fg) conforme au seuil AA (4.5:1)', () => {
    expect(wcagContrast(bg, fg)).toBeGreaterThanOrEqual(4.5);
  });

  it('contraste fond/texte atténué (nx-fg-muted) conforme au seuil AA (4.5:1)', () => {
    expect(wcagContrast(bg, fgMuted)).toBeGreaterThanOrEqual(4.5);
  });

  it('contraste fond/surface ne régresse pas par rapport à la valeur historique', () => {
    const before = wcagContrast(HISTORICAL_DARK_BG, surface);
    const after = wcagContrast(bg, surface);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('contraste fond/surface élevée ne régresse pas par rapport à la valeur historique', () => {
    const before = wcagContrast(HISTORICAL_DARK_BG, elevated);
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
