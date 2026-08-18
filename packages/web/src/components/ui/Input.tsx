import { forwardRef, type InputHTMLAttributes } from 'react';

import { NX } from '@/lib/tokens';

/**
 * Identité du contrôle : `id` **ou** `name`, au moins l'un des deux (MAN-245
 * Phase 4).
 *
 * Avant, `InputProps` héritait des deux en optionnel et le composant faisait
 * `id ?? rest.name` — silencieusement `undefined` si aucun n'était fourni. Le
 * `<label>` rendu pointait alors vers `htmlFor={undefined}` et ne nommait rien,
 * sans le moindre signal ni au typecheck ni au runtime.
 *
 * Le choix d'une union plutôt que d'un `id` strictement obligatoire vient d'une
 * mesure, pas d'une préférence : les 11 sites d'appel passent tous `name` et
 * aucun ne passe `id`. Exiger `id` aurait imposé 11 édits mécaniques sans rien
 * corriger — `name` produit déjà un identifiant fonctionnel. Ce qu'il fallait
 * rendre impossible, c'est de n'en fournir **aucun**.
 */
type InputIdentity =
  | { id: string; name?: string | undefined }
  | { id?: string | undefined; name: string };

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'name'> &
  InputIdentity & {
    // `| undefined` explicite : sous `exactOptionalPropertyTypes` les appelants
    // qui passent `error={state.foo}` (où `foo` peut être `undefined`) seraient
    // refusés. On accepte explicitement la valeur undefined.
    label?: string | undefined;
    error?: string | undefined;
    hint?: string | undefined;
  };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, name, style, ...rest },
  ref,
) {
  // Le `??` subsiste, mais son cas `undefined` est désormais inatteignable :
  // `InputIdentity` garantit qu'au moins l'un des deux est fourni. C'est le
  // type qui porte l'invariant, plus la vigilance de l'appelant.
  const inputId = id ?? name;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: 12, fontWeight: 500, color: NX.fgMuted }}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        name={name}
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
