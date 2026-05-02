/**
 * Button — Nexus DS v2 (CVA + Tailwind, shadcn-compatible).
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
    'transition-all duration-fast ease-nx',
    'focus-visible:outline-none focus-visible:shadow-focus',
    'disabled:opacity-55 disabled:cursor-not-allowed',
    'active:scale-[0.98]',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground rounded-pill hover:bg-primary/90',
        secondary:
          'bg-secondary text-secondary-foreground border border-nx-border rounded-md hover:bg-secondary/80 hover:border-nx-border-hover',
        ghost: 'rounded-md text-foreground hover:bg-nx-raised',
        destructive:
          'bg-destructive/10 text-destructive border border-destructive/20 rounded-md hover:bg-destructive/20',
        /** Orange en light (CTA AI), violet en dark. À réserver aux moments brand / IA. */
        brand:
          'bg-nx-segmented-active text-nx-segmented-active-fg rounded-pill hover:opacity-90',
        /** Petit bouton circulaire pour les actions inline (kebab, share). */
        icon:
          'bg-card text-foreground border border-nx-border rounded-pill hover:bg-nx-raised',
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
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
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
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
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
