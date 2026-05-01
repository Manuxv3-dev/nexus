/**
 * Logo Nexus — trois nœuds interconnectés. Single source of truth pour le mark.
 */
export interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      className={className}
      aria-label="Nexus"
    >
      <circle cx="26" cy="26" r="8" fill="#7c5cfc" />
      <circle cx="54" cy="26" r="8" fill="#a78bfa" />
      <circle cx="40" cy="54" r="8" fill="#c084fc" />
      <line x1="26" y1="26" x2="54" y2="26" stroke="#7c5cfc" strokeWidth="2.5" opacity="0.6" />
      <line x1="26" y1="26" x2="40" y2="54" stroke="#a78bfa" strokeWidth="2.5" opacity="0.6" />
      <line x1="54" y1="26" x2="40" y2="54" stroke="#c084fc" strokeWidth="2.5" opacity="0.6" />
    </svg>
  );
}

export function Wordmark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <div className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <Logo size={size + 8} />
      <span
        style={{
          fontSize: size,
          fontWeight: 800,
          letterSpacing: '-0.04em',
          color: 'hsl(var(--foreground))',
        }}
      >
        nexus
      </span>
    </div>
  );
}
