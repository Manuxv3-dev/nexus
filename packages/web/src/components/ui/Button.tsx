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
    'active:scale-[0.96]',
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
    ...props
  },
  ref,
) {
  const Comp: React.ElementType = asChild ? Slot : 'button';
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
