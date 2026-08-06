/**
 * GlassDialogShell — tests (MAN-201).
 *
 * Le stub par défaut de `window.matchMedia` (branche desktop, `matches:
 * false`) vit dans `test/setup.ts` — voir sa JSDoc pour le pourquoi. Les
 * quelques tests ci-dessous qui exercent explicitement le comportement
 * MOBILE de `useDialogCtaSize`/`GlassDialogSecondaryButton` réaffectent
 * `window.matchMedia` localement via `mockMobileMatchMedia()`, qui gagne sur
 * le stub global (réaffectation postérieure dans l'ordre des hooks/du corps
 * de test) sans que les autres tests du fichier n'aient à s'en soucier.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { GlassDialogSecondaryButton, GlassDialogShell, useDialogCtaSize } from './GlassDialogShell';

/** Réaffecte `window.matchMedia` pour ce test précis sur la branche mobile (`matches: true`). */
function mockMobileMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(false),
  }));
}

describe('GlassDialogShell', () => {
  describe('contrat a11y', () => {
    it('expose role="dialog", aria-modal="true", et un nom accessible dérivé du titre', () => {
      render(
        <GlassDialogShell title="Confirmer l'action" onClose={vi.fn()}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      const dialog = screen.getByRole('dialog', { name: "Confirmer l'action" });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      // Le titre est bien un heading (h2), pas seulement un texte visuel
      // planqué derrière aria-labelledby.
      expect(screen.getByRole('heading', { name: "Confirmer l'action" })).toBeInTheDocument();
    });

    it('Escape ferme le dialog et appelle onClose', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <GlassDialogShell title="T" onClose={onClose}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Escape n’appelle pas onClose quand closeDisabled est vrai (ex. mutation en cours)', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <GlassDialogShell title="T" onClose={onClose} closeDisabled>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      await user.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
    });

    it('le clic sur l’overlay ferme le dialog, sauf quand closeDisabled est vrai', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(
        <GlassDialogShell title="T" onClose={onClose} closeDisabled>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      await user.click(screen.getByRole('dialog'));
      expect(onClose).not.toHaveBeenCalled();

      rerender(
        <GlassDialogShell title="T" onClose={onClose}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );
      await user.click(screen.getByRole('dialog'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('le clic à l’intérieur de la carte ne ferme pas le dialog (stopPropagation)', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <GlassDialogShell title="T" onClose={onClose}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      await user.click(screen.getByRole('button', { name: 'OK' }));

      expect(onClose).not.toHaveBeenCalled();
    });

    it('déplace le focus dans le dialog à l’ouverture, et boucle Tab/Shift+Tab aux bornes sans jamais fuir vers le contenu externe', async () => {
      // Preuve que l'assertion n'est pas vacueuse : "Avant"/"Après" entourent
      // le dialog dans l'ordre naturel du DOM. Sans le trap, `Tab` depuis
      // "Dernier" irait à "Après" et `Shift+Tab` depuis "Premier" irait à
      // "Avant" — le test échouerait.
      const user = userEvent.setup();
      render(
        <>
          <button type="button">Avant</button>
          <GlassDialogShell title="T" onClose={vi.fn()}>
            <button type="button">Premier</button>
            <button type="button">Dernier</button>
          </GlassDialogShell>
          <button type="button">Après</button>
        </>,
      );

      const first = screen.getByRole('button', { name: 'Premier' });
      const last = screen.getByRole('button', { name: 'Dernier' });

      expect(first).toHaveFocus();

      await user.tab();
      expect(last).toHaveFocus();

      await user.tab();
      expect(first).toHaveFocus();

      await user.tab({ shift: true });
      expect(last).toHaveFocus();

      await user.tab({ shift: true });
      expect(first).toHaveFocus();
    });

    it('rend le focus à l’élément déclencheur après la fermeture du dialog', async () => {
      function Harness() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Ouvrir
            </button>
            {open ? (
              <GlassDialogShell title="T" onClose={() => setOpen(false)}>
                <button type="button">OK</button>
              </GlassDialogShell>
            ) : null}
          </>
        );
      }

      const user = userEvent.setup();
      render(<Harness />);

      const trigger = screen.getByRole('button', { name: 'Ouvrir' });
      await user.click(trigger);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  describe('responsive (MAN-201)', () => {
    it('sans élément focusable dans la carte, le focus tombe sur la carte elle-même (pas de fuite)', () => {
      render(
        <GlassDialogShell title="Chargement…" onClose={vi.fn()}>
          <p>Patiente…</p>
        </GlassDialogShell>,
      );

      // La carte (role dialog est sur l'overlay, la carte est son enfant
      // direct sans role) reçoit le focus via son `tabIndex={-1}` de secours.
      expect(document.activeElement).toHaveAttribute('tabindex', '-1');
    });
  });
});

describe('useDialogCtaSize', () => {
  function Probe() {
    const size = useDialogCtaSize();
    return <span data-testid="size">{size}</span>;
  }

  it('retourne "sm" en desktop (comportement historique inchangé, stub global de test/setup.ts)', () => {
    render(<Probe />);
    expect(screen.getByTestId('size')).toHaveTextContent('sm');
  });

  it('retourne "lg" (44px) sous le breakpoint mobile', () => {
    mockMobileMatchMedia();
    render(<Probe />);
    expect(screen.getByTestId('size')).toHaveTextContent('lg');
  });
});

describe('GlassDialogSecondaryButton', () => {
  it('garde le padding compact historique en desktop (stub global de test/setup.ts)', () => {
    render(<GlassDialogSecondaryButton>Annuler</GlassDialogSecondaryButton>);
    const button = screen.getByRole('button', { name: 'Annuler' });
    expect(button.style.minHeight).toBe('');
  });

  it('atteint la cible tactile 44px sous le breakpoint mobile', () => {
    mockMobileMatchMedia();
    render(<GlassDialogSecondaryButton>Annuler</GlassDialogSecondaryButton>);
    const button = screen.getByRole('button', { name: 'Annuler' });
    expect(button.style.minHeight).toBe('44px');
  });

  it('curseur "wait" quand disabled, "pointer" sinon', () => {
    const { rerender } = render(
      <GlassDialogSecondaryButton disabled>Annuler</GlassDialogSecondaryButton>,
    );
    expect(screen.getByRole('button', { name: 'Annuler' }).style.cursor).toBe('wait');

    rerender(<GlassDialogSecondaryButton>Annuler</GlassDialogSecondaryButton>);
    expect(screen.getByRole('button', { name: 'Annuler' }).style.cursor).toBe('pointer');
  });
});
