import { NX } from '@/lib/tokens';

export interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  /**
   * `id` de l'élément qui explique l'état du toggle (typiquement la `desc` de
   * la `SettingsRow` qui le porte). Indispensable quand le toggle est
   * `disabled` pour une raison non devinable — sans association explicite, la
   * raison n'est qu'un texte voisin, pas une description du contrôle.
   */
  ariaDescribedBy?: string;
  /** Désactive l'interaction (ex. capacité non supportée, appel en cours). */
  disabled?: boolean;
}

export function Toggle({ on, onChange, ariaLabel, ariaDescribedBy, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s',
        background: on ? NX.primary : NX.raised,
        position: 'relative',
        flexShrink: 0,
        border: 'none',
        padding: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          background: '#fff',
          position: 'absolute',
          top: 2,
          left: on ? 20 : 2,
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}
