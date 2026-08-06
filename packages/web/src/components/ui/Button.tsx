/**
 * Button — nexus DS v2 (CVA + Tailwind, shadcn-compatible).
 *
 * Migration depuis l'ancienne version inline-style. API préservée :
 *   variant ('primary' | 'secondary' | 'ghost' | 'destructive')
 *   size ('sm' | 'md' | 'lg')
 *   loading, leftIcon, rightIcon, fullWidth, disabled
 * Nouveau :
 *   variant 'brand' (orange/violet — AI moments) + 'icon'
 *   size 'icon' (carré 40×40)
 *   asChild (Slot Radix — utile pour wrapper un <a> avec le style Button)
 *
 * MAN-208 : `softDisabled={true}` (ou, en filet de sécurité, `aria-disabled`
 * brut à `true`/`'true'`) rend le bouton structurellement inerte — son
 * `onClick` devient un no-op — pas seulement grisé visuellement (cf. JSDoc
 * de `buttonVariants` plus bas pour le pourquoi de `aria-disabled` vs
 * `disabled` natif). `asChild` (Slot Radix) n'a aujourd'hui aucun appelant
 * dans ce repo, mais le cas mérite d'être connu s'il en gagne un :
 * `@radix-ui/react-slot` fait gagner les props NON-handler du child rendu
 * sur celles posées sur `Button` (`aria-disabled` en fait partie) — un
 * enfant portant son propre `aria-disabled={false}` s'afficherait donc
 * "enabled" dans le DOM alors que `softDisabled`, calculé uniquement à
 * partir des props de `Button` elle-même, avalerait quand même le clic :
 * un bouton qui a l'air actionnable mais ne l'est pas, l'inverse du bug que
 * ce ticket corrige, dans le même registre "apparence ≠ comportement".
 */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold',
    'transition-all duration-fast ease-nx-spring',
    'focus-visible:outline-none focus-visible:shadow-focus',
    // `disabled:shadow-none` neutralise les `hover:shadow-*` des variants :
    // `:hover` s'applique aussi à un <button disabled>, un relief au survol
    // ferait passer un bouton inerte pour actionnable.
    // Les variantes `aria-disabled:*` (support natif Tailwind, matché sur
    // `[aria-disabled="true"]`) donnent le même rendu visuel qu'un bouton
    // natif `disabled` à un bouton "grisé mais focusable" (`aria-disabled`
    // sans `disabled`) — cf. MAN-197 : un `disabled` natif sort du tab order,
    // ce qui empêche clavier/lecteur d'écran d'atteindre le `title`
    // explicatif d'une action indisponible.
    'disabled:opacity-55 disabled:cursor-not-allowed disabled:shadow-none',
    'aria-disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:shadow-none',
    // `aria-disabled:shadow-none` ci-dessus a la même spécificité (0-2-0) que
    // `focus-visible:shadow-focus`, et Tailwind l'émet plus tard dans le CSS
    // généré → il gagnerait la cascade et un tab clavier sur un bouton
    // `aria-disabled` (donc toujours focusable, cf. JSDoc ci-dessus)
    // n'afficherait AUCUN indicateur de focus (régression WCAG 2.4.7
    // introduite par le passage `disabled` → `aria-disabled` lui-même,
    // puisqu'un `disabled` natif sort du tab order et ne pouvait donc pas
    // matcher `:focus-visible`). Cette variante combinée compile en
    // `.aria-disabled\:focus-visible\:shadow-focus:focus-visible[aria-disabled="true"]`
    // (0-3-0), qui l'emporte sur `aria-disabled:shadow-none` quel que soit
    // l'ordre d'émission — vérifié en compilant le CSS Tailwind réel (cf.
    // commit MAN-197 review fix).
    'aria-disabled:focus-visible:shadow-focus',
    'active:scale-[0.96]',
    // Un `disabled` natif ne matche jamais `:active` — mais `aria-disabled`
    // seul n'empêche rien côté navigateur (ce n'est pas un vrai attribut
    // désactivant), donc `active:scale-[0.96]` continuerait de jouer
    // l'animation de pression sur un bouton qui, visuellement, prétend être
    // inerte (`cursor-not-allowed`, opacité réduite). Neutralisée ici avec
    // une spécificité supérieure à la règle `active:scale-[0.96]` simple.
    'aria-disabled:active:scale-100',
  ].join(' '),
  {
    variants: {
      variant: {
        /**
         * Hover = `--nx-primary-deep` (et pas `--nx-primary-hover`) : le hover
         * porte du texte blanc, or `--nx-primary-hover` éclaircit le bleu en
         * dark (#3D9CFF) et ferait tomber le contraste texte de 3.65 à 2.84.
         * `deep` fonce dans les deux thèmes → 4.02→7.57 (light), 3.65→5.57 (dark).
         */
        primary:
          'bg-primary text-primary-foreground rounded-pill hover:bg-nx-primary-deep hover:shadow-sm',
        /**
         * Hover = surface `--nx-elevated`. Une opacité sur `bg-secondary`
         * mélange le fond du bouton à ce qu'il y a derrière : sur une carte
         * (`--card` == `--secondary`) le survol serait invisible, et sur la page
         * il rapprocherait le bouton du fond au lieu de l'en détacher.
         */
        secondary:
          'bg-secondary text-secondary-foreground border border-nx-border rounded-md hover:bg-nx-elevated hover:border-nx-border-hover hover:shadow-sm',
        ghost: 'rounded-md text-foreground hover:bg-nx-raised hover:shadow-sm',
        /**
         * Le renfort passe par la bordure et le relief, pas par le remplissage :
         * `text-destructive` est posé sur ce remplissage, chaque cran d'opacité
         * en plus lui coûte du contraste (2.49 → 2.18 sur carte en light à /30).
         */
        destructive:
          'bg-destructive/10 text-destructive border border-destructive/20 rounded-md hover:bg-destructive/20 hover:border-destructive/50 hover:shadow-sm',
        /**
         * Orange en light (CTA AI), violet en dark. À réserver aux moments brand / IA.
         * `opacity` délaye le texte en même temps que le fond : le renfort vient du
         * relief, pas d'une opacité plus basse (3.49 → 3.04 en light à /80).
         */
        brand:
          'bg-nx-segmented-active text-nx-segmented-active-fg rounded-pill hover:opacity-90 hover:shadow-md',
        /** Petit bouton circulaire pour les actions inline (kebab, share). */
        icon: 'bg-card text-foreground border border-nx-border rounded-pill hover:bg-nx-raised hover:shadow-sm',
      },
      size: {
        sm: 'h-8 px-3.5 text-xs',
        md: 'h-10 px-5 text-sm',
        lg: 'h-11 px-6 text-sm',
        /** Carré 40×40 sans padding latéral, à associer à `variant="icon"`. */
        icon: 'h-10 w-10 p-0',
      },
      fullWidth: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /**
   * MAN-208 : API typée pour un bouton "grisé mais focusable" (cf. JSDoc de
   * fichier ci-dessus) — préférer `softDisabled={cond}` à un `aria-disabled`
   * brut : ça se lit comme du comportement (un booléen typé) plutôt que
   * comme une simple annotation d'accessibilité, et `Button` pose alors
   * elle-même l'attribut `aria-disabled` correspondant, sans que l'appelant
   * ait à le dupliquer.
   *
   * L'attribut `aria-disabled` brut reste lu en parallèle (cf. corps du
   * composant) comme filet de sécurité, PAS comme redondance gratuite :
   * l'intérêt de MAN-208 est justement de protéger le futur appelant qui
   * copierait `aria-disabled={cond}` d'un call site existant sans passer par
   * `softDisabled` — ce filet fait que même ce copier-coller reste sûr.
   */
  softDisabled?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    asChild,
    loading,
    leftIcon,
    rightIcon,
    children,
    disabled,
    type,
    onClick,
    softDisabled,
    'aria-disabled': ariaDisabledProp,
    ...props
  },
  ref,
) {
  const Comp: React.ElementType = asChild ? Slot : 'button';
  // MAN-208 : deux chemins vers le même calcul, `softDisabled` (prop typée,
  // API documentée — cf. JSDoc de `ButtonProps`) et l'`aria-disabled` brut
  // lu en filet de sécurité. Ni l'un ni l'autre ne désactive quoi que ce
  // soit côté navigateur par eux-mêmes (contrairement à `disabled` natif,
  // cf. JSDoc `buttonVariants` ci-dessus / MAN-197) — sans ce garde-fou, un
  // bouton "grisé" avait l'apparence d'un bouton inerte mais restait
  // entièrement cliquable, et seul un `if (!canManage) return;` écrit à la
  // main dans chaque `onClick` appelant empêchait l'action.
  //
  // Le type `Booleanish` de `aria-disabled` (`boolean | 'true' | 'false'`)
  // laisse un appelant écrire le littéral JSX `aria-disabled="false"` — une
  // chaîne non vide, donc truthy en JS. D'où la comparaison explicite à
  // `true`/`'true'`, jamais la troncature de vérité de la prop brute.
  const resolvedSoftDisabled =
    softDisabled === true || ariaDisabledProp === true || ariaDisabledProp === 'true';
  // Un <button> natif déclenche déjà `click` sur Entrée/Espace : avaler
  // `onClick` suffit donc à couvrir aussi l'activation clavier, sans code
  // dédié. Tout handler AUTRE que `onClick` fourni par l'appelant
  // (`onKeyDown`, `onKeyUp`, `onClickCapture`, `onMouseDown`, `onPointerDown`,
  // etc.) n'est PAS intercepté ici (hors-scope MAN-208) : `Button` n'a
  // aujourd'hui aucun appelant qui déclenche une action métier depuis l'un
  // de ces handlers plutôt que depuis `onClick`.
  const handleClick = resolvedSoftDisabled
    ? (event: React.MouseEvent<HTMLButtonElement>) => {
        // `stopPropagation` (en plus de `preventDefault`) reproduit le
        // contrat d'un vrai `disabled` natif : un <button disabled> ne
        // dispatche aucun `click`, ses ancêtres n'en voient donc jamais.
        // Vérifié sans risque de régression sur les 3 listeners "clic
        // dehors" du repo (`GroupMenu.tsx`, `NotificationsBell.tsx`,
        // `CreateGroupForm.tsx`) : ils écoutent tous `mousedown`, un
        // évènement distinct déjà terminé avant que `click` n'existe.
        event.preventDefault();
        event.stopPropagation();
      }
    : onClick;
  // Pour `asChild`, le `type` ne peut être passé qu'au natif <button>.
  const nativeProps = asChild
    ? props
    : ({ type: type ?? 'button', ...props } as React.ButtonHTMLAttributes<HTMLButtonElement>);
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled === true || loading === true}
      {...nativeProps}
      aria-disabled={softDisabled ?? ariaDisabledProp}
      onClick={handleClick}
    >
      {loading ? <Spinner /> : leftIcon}
      {children}
      {!loading ? rightIcon : null}
    </Comp>
  );
});

function Spinner() {
  return (
    <svg className="animate-spin-slow h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { buttonVariants };
