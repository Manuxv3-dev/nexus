import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { NX } from '@/lib/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const SIZES: Record<ButtonSize, { padding: string; fontSize: number }> = {
  sm: { padding: '6px 14px', fontSize: 12 },
  md: { padding: '9px 20px', fontSize: 13 },
  lg: { padding: '11px 24px', fontSize: 14 },
};

const VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: NX.primary, color: '#fff', border: '1px solid transparent' },
  secondary: {
    background: NX.elevated,
    color: NX.fg,
    border: `1px solid ${NX.borderHover}`,
  },
  ghost: {
    background: 'transparent',
    color: NX.primaryText,
    border: '1px solid transparent',
  },
  destructive: {
    background: NX.errorBg,
    color: NX.error,
    border: '1px solid transparent',
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    style,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const sz = SIZES[size];
  const v = VARIANTS[variant];
  const isDisabled = disabled === true || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      style={{
        ...v,
        padding: sz.padding,
        fontSize: sz.fontSize,
        fontWeight: 600,
        borderRadius: NX.radiusPill,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.55 : 1,
        transition: 'all 0.2s var(--nx-transition-normal)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: fullWidth ? '100%' : 'auto',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          style={{ animation: 'spinSlow 1s linear infinite', display: 'inline-block' }}
        >
          ⟳
        </span>
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
