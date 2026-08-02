import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { PhIcon } from './PhIcon';

const VARIANTS = ['primary', 'secondary', 'ghost', 'destructive', 'brand', 'icon'] as const;

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

  // Test d'acceptation du slice (MAN-110 Task 4) : les 3 tâches précédentes ont
  // livré scale actif + easing spring (Task 1), hover renforcé par variant
  // (Task 2) et espacement icône/label (Task 3) au niveau du composant. Ici on
  // rejoue des parcours utilisateur complets (clavier et souris) sur les 6
  // variants pour prouver le slice de bout en bout, pas juste chaque couche
  // isolément — l'API du composant n'a pas changé, ces tests devraient déjà
  // passer sans modification de Button.tsx.
  describe('test d’acceptation E2E — parcours clavier et souris (MAN-110 Task 4)', () => {
    describe.each(VARIANTS.map((v) => [v] as const))('variant="%s"', (variant) => {
      it('parcours clavier complet : Tab → focus visible → Enter déclenche onClick → Tab suivant quitte le bouton', async () => {
        const onClick = vi.fn();
        const user = userEvent.setup();
        render(
          <>
            <Button variant={variant} onClick={onClick} aria-label="Action">
              {variant === 'icon' ? <PhIcon name="plus" size={16} /> : 'Action'}
            </Button>
            <button type="button">Suivant</button>
          </>,
        );

        const button = screen.getByRole('button', { name: 'Action' });
        const next = screen.getByRole('button', { name: 'Suivant' });

        await user.tab();
        expect(button).toHaveFocus();

        // Le focus visible doit rester porté par le même utilitaire quel que
        // soit le variant — c'est ce qui garantit un anneau de focus cohérent
        // sur les 6 (cf. classe partagée dans buttonVariants, pas par variant).
        const classes = button.className.split(/\s+/);
        expect(classes).toContain('focus-visible:shadow-focus');

        await user.keyboard('{Enter}');
        expect(onClick).toHaveBeenCalledTimes(1);

        // Pas de piège de focus : un Tab supplémentaire doit quitter le bouton.
        await user.tab();
        expect(button).not.toHaveFocus();
        expect(next).toHaveFocus();
      });

      it('active/déclenche onClick aussi via Espace, au clavier', async () => {
        const onClick = vi.fn();
        const user = userEvent.setup();
        render(
          <Button variant={variant} onClick={onClick} aria-label="Action">
            {variant === 'icon' ? <PhIcon name="plus" size={16} /> : 'Action'}
          </Button>,
        );

        const button = screen.getByRole('button', { name: 'Action' });
        await user.tab();
        expect(button).toHaveFocus();

        await user.keyboard(' ');
        expect(onClick).toHaveBeenCalledTimes(1);
      });

      it('parcours souris complet : hover → mousedown (état actif atteignable) → click déclenche onClick une seule fois', async () => {
        const onClick = vi.fn();
        const onMouseEnter = vi.fn();
        const user = userEvent.setup();
        render(
          <Button
            variant={variant}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            aria-label="Action"
          >
            {variant === 'icon' ? <PhIcon name="plus" size={16} /> : 'Action'}
          </Button>,
        );

        const button = screen.getByRole('button', { name: 'Action' });

        await user.hover(button);
        expect(onMouseEnter).toHaveBeenCalledTimes(1);

        // jsdom n'évalue pas le pseudo-sélecteur :active — on vérifie donc
        // que l'état actif est bien *atteignable* via la classe statique
        // (verrouillée en Task 1), avant de rejouer la séquence mousedown →
        // mouseup → click qui, dans un vrai navigateur, l'activerait.
        const classes = button.className.split(/\s+/);
        expect(classes).toContain('active:scale-[0.96]');

        await user.pointer([{ target: button, keys: '[MouseLeft>]' }]);
        await user.pointer([{ keys: '[/MouseLeft]' }]);

        expect(onClick).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('aucune régression disabled/loading sur les variants sensibles (MAN-110 Task 4)', () => {
    // primary et destructive sont les plus sensibles côté UX (CTA principal et
    // action destructrice) : un clic ou un Enter fantôme y coûte cher.
    describe.each([['primary'], ['destructive']] as const)('variant="%s"', (variant) => {
      it.each([
        ['disabled', { disabled: true }],
        ['loading', { loading: true }],
      ] as const)(
        'état %s : ni le clic, ni Enter ne déclenchent onClick, et le bouton n’est pas focusable',
        async (_label, extraProps) => {
          const onClick = vi.fn();
          const user = userEvent.setup();
          render(
            <>
              <button type="button">Avant</button>
              <Button variant={variant} onClick={onClick} {...extraProps}>
                Action
              </Button>
            </>,
          );

          const button = screen.getByRole('button', { name: 'Action' });
          // `disabled` HTML natif est le mécanisme sous-jacent des deux états
          // (loading force `disabled` via Button.tsx) : c'est lui qui garantit
          // le comportement d'accessibilité attendu par les lecteurs d'écran et
          // la navigation clavier, pas une classe CSS.
          expect(button).toBeDisabled();

          await user.click(screen.getByRole('button', { name: 'Avant' }));
          await user.tab();
          expect(button).not.toHaveFocus();

          button.focus();
          expect(button).not.toHaveFocus();

          await user.click(button);
          expect(onClick).not.toHaveBeenCalled();

          await user.keyboard('{Enter}');
          expect(onClick).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe('prefers-reduced-motion (MAN-110 Task 4)', () => {
    // Non testé automatiquement : jsdom n'évalue pas `@media
    // (prefers-reduced-motion: reduce)` (pas de moteur de rendu CSS ni de
    // `matchMedia` fonctionnel pour les media queries de préférences
    // utilisateur), donc un test qui simulerait la préférence ne prouverait
    // rien de réel. La réduction de mouvement est gérée globalement et non au
    // niveau du composant : `packages/web/src/styles/global.css:92` neutralise
    // `animation-duration`/`transition-duration` en `0.01ms !important` pour
    // tous les éléments dès que la préférence système est active — Button n'a
    // donc pas besoin d'un mécanisme dédié (pas de variante, pas de prop).
    // Vérification manuelle : activer "Réduire les animations" (macOS) ou
    // "Afficher les animations" désactivé (Windows) puis observer qu'un clic
    // sur un Button n'anime plus le scale/hover.
    //
    // Ce qui *est* vérifiable ici sans navigateur : que rien dans les classes
    // statiques de transition du composant n'utilise le modifier Tailwind
    // `!` (important), qui casserait la spécificité de la règle globale
    // ci-dessus en la rendant non prioritaire face à une transition marquée
    // importante localement.
    it('n’exporte aucune classe de transition/animation marquée !important qui court-circuiterait la règle globale', () => {
      render(<Button>Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const classes = button.className.split(/\s+/);

      const transitionRelated = classes.filter((c) =>
        /^!?(transition|duration|ease|animate)/.test(c),
      );
      expect(transitionRelated.length).toBeGreaterThan(0);
      expect(transitionRelated.every((c) => !c.startsWith('!'))).toBe(true);
    });
  });
});
