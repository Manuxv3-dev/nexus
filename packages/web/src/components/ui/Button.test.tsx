import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('affiche son label et déclenche onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Créer</Button>);

    const button = screen.getByRole('button', { name: 'Créer' });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('désactive le bouton et ignore les clics en mode loading', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Créer
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Créer' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('désactive le bouton et ignore les clics en mode disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Créer
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Créer' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applique un scale-down plus marqué au clic', () => {
    render(<Button>Créer</Button>);

    const button = screen.getByRole('button', { name: 'Créer' });
    const match = /active:scale-\[([\d.]+)\]/.exec(button.className);

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThan(0.98);
  });

  it('utilise l’easing spring au relâchement plutôt que ease-nx', () => {
    render(<Button>Créer</Button>);

    const button = screen.getByRole('button', { name: 'Créer' });
    const classes = button.className.split(/\s+/);

    expect(classes).toContain('ease-nx-spring');
    expect(classes).not.toContain('ease-nx');
  });

  describe('hover renforcé sur les 6 variants (MAN-110 Task 2)', () => {
    // Critère commun : chaque variant ajoute un léger relief (`hover:shadow-sm`
    // ou `hover:shadow-md`) en plus du changement de fond au survol — un signal
    // perceptible même pour les variants dont le changement de fond seul
    // resterait proche de son état de repos.
    it.each([['primary'], ['secondary'], ['ghost'], ['destructive'], ['brand'], ['icon']] as const)(
      'variant="%s" expose une classe hover:shadow-* en plus du hover de fond',
      (variant) => {
        render(<Button variant={variant}>Action</Button>);
        const button = screen.getByRole('button', { name: 'Action' });
        const classes = button.className.split(/\s+/);

        expect(classes.some((c) => /^hover:shadow-(sm|md)$/.test(c))).toBe(true);
      },
    );

    it('variant="primary" bascule sur le token de hover dédié plutôt qu’une opacité /90', () => {
      render(<Button variant="primary">Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const classes = button.className.split(/\s+/);

      expect(classes).toContain('hover:bg-nx-primary-hover');
      expect(classes.some((c) => /^hover:bg-primary\/\d+$/.test(c))).toBe(false);
    });

    it('variant="secondary" durcit son seuil d’opacité hover à 60 ou moins (au lieu de /80)', () => {
      render(<Button variant="secondary">Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const match = /hover:bg-secondary\/(\d+)/.exec(button.className);

      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBeLessThanOrEqual(60);
    });

    it('variant="destructive" durcit son seuil d’opacité hover au-delà de /20', () => {
      render(<Button variant="destructive">Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const match = /hover:bg-destructive\/(\d+)/.exec(button.className);

      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBeGreaterThan(20);
    });

    it('variant="brand" durcit son opacité hover en dessous de 90', () => {
      render(<Button variant="brand">Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const match = /hover:opacity-(\d+)/.exec(button.className);

      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBeLessThan(90);
    });
  });
});
