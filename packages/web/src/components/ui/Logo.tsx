/**
 * Logo nexus — variante "Atome" (DS v2, choisi 2026-05-03).
 *
 * 3 orbites superposées (60° d'écart) symbolisent la rotation/coordination,
 * 3 noyaux représentent 3 features clés via la palette Apple System Colors
 * (cf. ADR-021 DS v2 — true Apple, abandonné les pastels Claude) :
 *   - systemBlue   (#007AFF) — Events (planification)
 *   - systemGreen  (#34C759) — Todo (réalisation)
 *   - systemIndigo (#5856D6) — Chat / brand (messagerie, fil conducteur
 *                              avec l'ancien brand purple)
 *
 * Les couleurs sont les valeurs canoniques light Apple HIG ; elles restent
 * lisibles sur fond clair ET sombre (les variantes dark systemBlue=#0A84FF
 * etc. sont des ajustements perceptifs négligeables sur un mark de 32px).
 *
 * Les ellipses utilisent `currentColor` avec opacité 0.32 pour s'adapter
 * automatiquement au thème (dark/light) sans hardcoder.
 */
export interface LogoProps {
  size?: number | undefined;
  className?: string | undefined;
  /**
   * Variante HD — pour les grands usages (landing hero, login screen).
   * Même mark que le Logo standard, juste rendu plus grand par défaut, avec
   * des strokes orbites un peu plus épais (2.0 vs 1.75) pour conserver le
   * poids visuel à grande échelle. Aucun ajout décoratif.
   */
  hd?: boolean | undefined;
}

export function Logo({ size = 32, className, hd = false }: LogoProps) {
  if (hd) return <LogoHd size={size} className={className} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      className={className}
      role="img"
      aria-label="nexus"
    >
      {/* Orbites — strokes neutres semi-transparents, s'adaptent au thème */}
      <ellipse
        cx="40"
        cy="40"
        rx="27"
        ry="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        opacity="0.32"
      />
      <ellipse
        cx="40"
        cy="40"
        rx="27"
        ry="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        opacity="0.32"
        transform="rotate(60 40 40)"
      />
      <ellipse
        cx="40"
        cy="40"
        rx="27"
        ry="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        opacity="0.32"
        transform="rotate(120 40 40)"
      />
      {/* Noyaux — Apple System Colors triade Blue + Green + Indigo */}
      <circle cx="67" cy="40" r="7.5" fill="#007AFF" />
      <circle cx="26.5" cy="63.4" r="7.5" fill="#34C759" />
      <circle cx="26.5" cy="16.6" r="7.5" fill="#5856D6" />
    </svg>
  );
}

/**
 * Logo nexus — variante HD (landing hero / login).
 *
 * Décision 2026-05-03 (révision) : on garde STRICTEMENT le même mark que le
 * Logo standard, juste rendu plus grand par défaut. Pas de halo radial, pas
 * d'électrons, pas de gradient sphérique sur les noyaux : un SVG vectoriel
 * reste crisp à toutes tailles, l'enrichissement décoratif n'apporte rien et
 * pollue la lecture du symbole.
 *
 * Strokes des orbites un poil plus épais (2.0 vs 1.75) pour garder un poids
 * visuel équivalent au Logo petit format quand on l'agrandit en hero — c'est
 * le seul ajustement, et il reste imperceptible si on regarde côte à côte.
 */
export function LogoHd({ size = 96, className }: { size?: number | undefined; className?: string | undefined }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      className={className}
      role="img"
      aria-label="nexus"
    >
      <ellipse
        cx="40"
        cy="40"
        rx="27"
        ry="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.32"
      />
      <ellipse
        cx="40"
        cy="40"
        rx="27"
        ry="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.32"
        transform="rotate(60 40 40)"
      />
      <ellipse
        cx="40"
        cy="40"
        rx="27"
        ry="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.32"
        transform="rotate(120 40 40)"
      />
      <circle cx="67" cy="40" r="7.5" fill="#007AFF" />
      <circle cx="26.5" cy="63.4" r="7.5" fill="#34C759" />
      <circle cx="26.5" cy="16.6" r="7.5" fill="#5856D6" />
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
