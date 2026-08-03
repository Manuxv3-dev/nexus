/**
 * TitleBar — tests des contrôles fenêtre Tauri (MAN-111 Phase 2 : habillage
 * & entrée du shell/nav, Task 2 — profondeur visuelle).
 *
 * `isTauri()` (cf. lib/tauri.ts) lit `window.__TAURI_INTERNALS__` : on le
 * force pour forcer le rendu de `TitleBarInner` (no-op en navigateur web pur).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  describe('focus clavier (MAN-121)', () => {
    it('affiche un anneau de focus quand le bouton reçoit le focus au clavier', async () => {
      const user = userEvent.setup();
      render(<TitleBar />);

      // Un seul Tab (premier stop focusable de la page) : le heuristique
      // focus-visible de jsdom ne reconnaît fiablement que ce cas — un 2e/3e
      // Tab entre éléments déjà focusables n'est pas détecté par jsdom mais
      // fonctionne nativement dans le WebView Chromium/WebKit réel.
      await user.tab();

      const minimizeButton = screen.getByRole('button', { name: 'Réduire' });
      expect(minimizeButton).toHaveFocus();
      expect(minimizeButton.style.boxShadow).toContain('var(--nx-shadow-focus');
    });

    it("ne pose pas d'anneau de focus sur un clic souris (pas de focus-visible)", async () => {
      const user = userEvent.setup();
      render(<TitleBar />);

      // userEvent.click() simule aussi le survol (mouseenter) : on peut donc
      // porter l'ombre de hover (NX.shadowSm), mais pas l'anneau de focus.
      const closeButton = screen.getByRole('button', { name: 'Fermer' });
      await user.click(closeButton);

      expect(closeButton.style.boxShadow).not.toContain('var(--nx-shadow-focus');
    });
  });
});
