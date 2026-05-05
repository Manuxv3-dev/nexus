import { forwardRef, type InputHTMLAttributes } from 'react';

import { NX } from '@/lib/tokens';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  // `| undefined` explicite : sous `exactOptionalPropertyTypes` les appelants
  // qui passent `error={state.foo}` (où `foo` peut être `undefined`) seraient
  // refusés. On accepte explicitement la valeur undefined.
  label?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, style, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{ fontSize: 12, fontWeight: 500, color: NX.fgMuted }}
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        style={{
          padding: '11px 14px',
          borderRadius: NX.radiusSm,
          fontSize: 14,
          color: NX.fg,
          outline: 'none',
          background: NX.surface,
          border: `1px solid ${error ? NX.error : NX.border}`,
          transition: 'border-color 0.2s, box-shadow 0.2s',
          ...style,
        }}
        onFocus={(e) => {
          if (!error) {
            e.currentTarget.style.borderColor = NX.primary;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${NX.primaryMuted}`;
          }
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error ? NX.error : NX.border;
          e.currentTarget.style.boxShadow = 'none';
          rest.onBlur?.(e);
        }}
        {...rest}
      />
      {error && <div style={{ fontSize: 11, color: NX.error }}>{error}</div>}
      {!error && hint && <div style={{ fontSize: 11, color: NX.fgDim }}>{hint}</div>}
    </div>
  );
});
