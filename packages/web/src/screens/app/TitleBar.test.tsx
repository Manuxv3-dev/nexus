/**
 * TitleBar — tests des contrôles fenêtre Tauri (MAN-111 Phase 2 : habillage
 * & entrée du shell/nav, Task 2 — profondeur visuelle).
 *
 * `isTauri()` (cf. lib/tauri.ts) lit `window.__TAURI_INTERNALS__` : on le
 * force pour forcer le rendu de `TitleBarInner` (no-op en navigateur web pur).
 */
import { fireEvent, render, screen } from '@testing-library/react';
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
    it('ne porte pas d’ombre au repos (cluster transparent, rien à porter)', () => {
      render(<TitleBar />);

      const closeButton = screen.getByRole('button', { name: 'Fermer' });
      expect(closeButton.style.boxShadow === '' || closeButton.style.boxShadow === 'none').toBe(
        true,
      );
    });

    it('porte un token d’ombre au survol, une fois le fond devenu opaque', () => {
      render(<TitleBar />);

      // Le relief n'a de sens que quand le bouton a une surface (fond
      // opaque au survol) pour le porter — sinon l'ombre flotte sans rien
      // en dessous.
      const closeButton = screen.getByRole('button', { name: 'Fermer' });
      fireEvent.mouseEnter(closeButton);

      expect(closeButton.style.boxShadow).toContain('var(--nx-shadow');
    });
  });
});
