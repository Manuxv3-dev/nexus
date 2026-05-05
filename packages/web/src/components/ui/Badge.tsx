/**
 * Badge / Pill — nexus DS v2 (CVA + Tailwind).
 *
 * Migration depuis l'inline-style version. API préservée (props `tone` + `size`)
 * + ajout de `leftIcon` et `tone="brand"` (orange/violet — segmented active,
 * AI suggestions). Les classes Tailwind résolvent `var(--nx-*)` → mode-aware.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-nx-raised text-nx-fg-muted border border-nx-border',
        primary: 'bg-nx-primary-muted text-nx-primary-text',
        success: 'bg-nx-success-bg text-nx-success',
        warning: 'bg-nx-warning-bg text-nx-warning',
        error: 'bg-nx-error-bg text-nx-error',
        info: 'bg-nx-info-bg text-nx-info',
        discord: 'bg-nx-discord-bg text-nx-discord',
        whatsapp: 'bg-nx-whatsapp-bg text-nx-whatsapp',
        messenger: 'bg-nx-messenger-bg text-nx-messenger',
        /** Orange light / violet dark — segmented active + AI suggestions. */
        brand: 'bg-nx-segmented-active text-nx-segmented-active-fg',
      },
      size: {
        sm: 'h-5 px-2 text-[10px]',
        md: 'h-6 px-2.5 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>['size']>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  leftIcon?: React.ReactNode;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone, size, leftIcon, children, ...props },
  ref,
) {
  return (
    <span ref={ref} className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {leftIcon ? (
        <span className="flex h-3 w-3 items-center justify-center" aria-hidden>
          {leftIcon}
        </span>
      ) : null}
      {children}
    </span>
  );
});

export { badgeVariants };
