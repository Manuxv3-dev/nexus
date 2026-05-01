import { NX } from '@/lib/tokens';

export interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}

export function Toggle({ on, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={() => onChange(!on)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        cursor: 'pointer',
        transition: 'background 0.2s',
        background: on ? NX.primary : NX.raised,
        position: 'relative',
        flexShrink: 0,
        border: 'none',
        padding: 0,
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
