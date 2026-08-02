/**
 * TitleBar — tests des contrôles fenêtre Tauri (MAN-111 Phase 2 : habillage
 * & entrée du shell/nav, Task 2 — profondeur visuelle).
 *
 * `isTauri()` (cf. lib/tauri.ts) lit `window.__TAURI_INTERNALS__` : on le
 * force pour forcer le rendu de `TitleBarInner` (no-op en navigateur web pur).
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TitleBar } from './TitleBar';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

describe('TitleBar', () => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  describe('profondeur visuelle (MAN-111 Task 2)', () => {
    it('porte un token d’ombre sur le cluster de contrôles fenêtre flottant', () => {
      render(<TitleBar />);

      // Les 3 boutons (Réduire/Agrandir/Fermer) flottent par-dessus le
      // contenu (webviews Tauri incluses) : un léger relief les distingue
      // visuellement de ce qu'il y a en dessous, plutôt qu'un simple carré
      // plat collé au coin de la fenêtre.
      const closeButton = screen.getByRole('button', { name: 'Fermer' });
      const controlsCluster = closeButton.parentElement;
      if (!controlsCluster) throw new Error('parentElement introuvable');

      expect(controlsCluster.style.boxShadow).not.toBe('');
      expect(controlsCluster.style.boxShadow).toContain('var(--nx-shadow');
    });
  });
});
