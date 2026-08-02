import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { PhIcon } from './PhIcon';

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

  describe('espacement icône/label (MAN-110 Task 3)', () => {
    // Constat d'investigation : un `gap-2` (8px) uniforme entre icône et label
    // reste proportionné sur les 3 tailles car c'est le padding horizontal
    // (`px-3.5` → `px-5` → `px-6`) et la hauteur (`h-8` → `h-10` → `h-11`) qui
    // absorbent l'essentiel de l'écart d'échelle entre sm/md/lg — le texte, lui,
    // ne grandit quasi pas (12px en sm, 13px en md/lg). Faire varier le gap en
    // plus du padding créerait une double compensation et un rythme moins
    // cohérent. Ces tests verrouillent ce choix assumé en régression plutôt que
    // d'introduire un gap par taille qui ne corrige aucun problème visuel réel.
    it.each([['sm'], ['md'], ['lg']] as const)(
      'size="%s" garde un gap-2 uniforme entre leftIcon et le label, compensé par le padding horizontal',
      (size) => {
        render(
          <Button size={size} leftIcon={<PhIcon name="plus" size={16} />}>
            Action
          </Button>,
        );
        const button = screen.getByRole('button', { name: 'Action' });
        const classes = button.className.split(/\s+/);

        expect(classes).toContain('gap-2');
        expect(classes.some((c) => c.startsWith('px-'))).toBe(true);
      },
    );

    it('size="icon" centre l’icône sans padding latéral parasite qui la décentrerait', () => {
      render(
        <Button variant="icon" size="icon" aria-label="Fermer">
          <PhIcon name="x" size={16} />
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Fermer' });
      const classes = button.className.split(/\s+/);

      // Seul p-0 doit subsister : tout px-*/py-*/pl-*/pr-* résiduel décentrerait
      // l'icône unique dans le carré 40×40.
      const paddingClasses = classes.filter((c) => /^p[xytrbl]?-/.test(c));
      expect(paddingClasses).toEqual(['p-0']);
      expect(classes).toContain('items-center');
      expect(classes).toContain('justify-center');
    });
  });
});
