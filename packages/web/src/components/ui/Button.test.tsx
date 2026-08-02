import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

    it('variant="primary" bascule sur un token de fond dédié plutôt qu’une opacité /90', () => {
      render(<Button variant="primary">Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const classes = button.className.split(/\s+/);

      expect(classes).toContain('hover:bg-nx-primary-deep');
      expect(classes.some((c) => /^hover:bg-primary\/\d+$/.test(c))).toBe(false);
    });

    it('variant="secondary" survole vers une surface opaque, pas vers une opacité de son propre fond', () => {
      render(<Button variant="secondary">Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const classes = button.className.split(/\s+/);

      // `bg-secondary/<x>` mélange le bouton à ce qu'il y a derrière : invisible
      // sur une carte (`--card` == `--secondary`), et sur la page il rapproche le
      // bouton du fond au lieu de l'en détacher.
      expect(classes.some((c) => /^hover:bg-secondary\/\d+$/.test(c))).toBe(false);
      expect(classes).toContain('hover:bg-nx-elevated');
      expect(classes).toContain('hover:border-nx-border-hover');
    });

    it('variant="destructive" renforce bordure et relief sans charger le remplissage sous son texte', () => {
      render(<Button variant="destructive">Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const classes = button.className.split(/\s+/);

      const fill = /(?:^|\s)bg-destructive\/(\d+)/.exec(button.className);
      const hoverFill = /hover:bg-destructive\/(\d+)/.exec(button.className);
      const border = /(?:^|\s)border-destructive\/(\d+)/.exec(button.className);
      const hoverBorder = /hover:border-destructive\/(\d+)/.exec(button.className);

      // `text-destructive` est posé sur ce remplissage : chaque cran d'opacité en
      // plus au survol lui coûte du contraste (2.49 → 2.18 sur carte, en light,
      // en passant de /20 à /30). Le renfort doit venir de la bordure/du relief.
      expect(Number(hoverFill?.[1])).toBeLessThanOrEqual(20);
      expect(Number(hoverFill?.[1])).toBeGreaterThan(Number(fill?.[1]));
      expect(Number(hoverBorder?.[1])).toBeGreaterThan(Number(border?.[1]));
      expect(classes).toContain('hover:shadow-sm');
    });

    it('variant="brand" ne descend pas son opacité hover sous 90 et renforce par le relief', () => {
      render(<Button variant="brand">Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const classes = button.className.split(/\s+/);
      const match = /hover:opacity-(\d+)/.exec(button.className);

      // `opacity` délaye le texte en même temps que le fond : à /80 le contraste
      // texte/fond du CTA brand tombe de 3.49 à 3.04 en light.
      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBeGreaterThanOrEqual(90);
      expect(classes).toContain('hover:shadow-md');
    });

    it('neutralise le relief de survol quand le bouton est disabled', () => {
      render(<Button disabled>Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      const classes = button.className.split(/\s+/);

      // `:hover` s'applique aussi à un <button disabled> : sans ce garde-fou, un
      // bouton inerte prendrait du relief au survol et paraîtrait actionnable.
      expect(classes).toContain('disabled:shadow-none');
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
  // Garde-fou de contraste (revue MAN-110) : les tests ci-dessus verrouillent des
  // *noms de classes*, ils ne savent pas si le token visé est lisible. Or c'est
  // exactement là qu'un hover se casse : `--nx-primary-hover` éclaircit le bleu en
  // dark (#3D9CFF), ce qui faisait tomber le contraste du texte blanc du CTA de
  // 3.65 à 2.84 alors que le nom du token sonnait juste. On résout donc les classes
  // rendues jusqu'aux valeurs de `styles/tokens.css` et on mesure (WCAG 2.1).
  describe('contraste du fond de survol (garde-fou tokens)', () => {
    // `vitest.config.ts` désactive le pipeline CSS (`css: false`) : on lit le
    // fichier de tokens à la source plutôt que de l'importer.
    const TOKENS = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/tokens.css'),
      'utf8',
    );

    type Rgb = readonly [number, number, number];

    /** Variables CSS déclarées dans le bloc d'un thème de `tokens.css`. */
    function readThemeVars(selector: string): Map<string, string> {
      const start = TOKENS.indexOf(selector);
      if (start === -1) throw new Error(`bloc \`${selector}\` introuvable dans tokens.css`);
      const block = TOKENS.slice(start, TOKENS.indexOf('}', start));
      const vars = new Map<string, string>();
      for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
        if (name !== undefined && value !== undefined) vars.set(name, value.trim());
      }
      return vars;
    }

    /** `#RRGGBB` ou triplet de canaux HSL shadcn (`211 100% 52%`). */
    function toRgb(value: string): Rgb {
      const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
      if (hex) {
        return [1, 2, 3].map((i) => Number.parseInt(hex[i] ?? '0', 16)) as unknown as Rgb;
      }
      const hsl = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
      if (!hsl) throw new Error(`couleur non supportée par le garde-fou : ${value}`);
      const [h, s, l] = [1, 2, 3].map((i) => Number(hsl[i]));
      const sat = (s ?? 0) / 100;
      const lum = (l ?? 0) / 100;
      const k = (n: number) => (n + (h ?? 0) / 30) % 12;
      const a = sat * Math.min(lum, 1 - lum);
      const channel = (n: number) =>
        Math.round(255 * (lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
      return [channel(0), channel(8), channel(4)];
    }

    function contrast(fg: Rgb, bg: Rgb): number {
      const luminance = (rgb: Rgb) =>
        0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2]);
      const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    }

    function srgb(channel: number): number {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    /**
     * Résout une classe Tailwind pleine (`bg-primary`, `hover:bg-nx-primary-deep`)
     * vers la couleur du thème. Les classes à opacité (`bg-x/50`) sont hors
     * périmètre : leur rendu dépend de ce qu'il y a derrière le bouton.
     */
    function resolveColor(classes: string[], prefix: string, vars: Map<string, string>): Rgb {
      const token = classes
        .filter((c) => c.startsWith(prefix))
        .map((c) => c.slice(prefix.length))
        .find((t) => vars.has(`--${t}`));
      if (token === undefined) throw new Error(`aucune classe \`${prefix}*\` résoluble en token`);
      const value = vars.get(`--${token}`);
      return toRgb(value ?? '');
    }

    it.each([['dark'], ['light']] as const)(
      'thème %s : le hover du variant primary ne coûte pas de contraste au label et passe AA',
      (theme) => {
        const vars = readThemeVars(`[data-theme="${theme}"] {`);
        render(<Button variant="primary">Action</Button>);
        const classes = screen.getByRole('button', { name: 'Action' }).className.split(/\s+/);

        const label = resolveColor(classes, 'text-', vars);
        const rest = contrast(label, resolveColor(classes, 'bg-', vars));
        const hover = contrast(label, resolveColor(classes, 'hover:bg-', vars));

        expect(hover).toBeGreaterThanOrEqual(rest);
        expect(hover).toBeGreaterThanOrEqual(4.5);
      },
    );
  });
});
