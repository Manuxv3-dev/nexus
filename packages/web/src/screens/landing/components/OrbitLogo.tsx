/**
 * Marque nexus animée — variante landing du `Logo` de `@/components/ui`
 * (mêmes coordonnées/couleurs) avec les 3 orbites en rotation continue.
 *
 * Séparée du `Logo` partagé : `Logo` est utilisé partout dans l'app sans
 * animation, et le piège documenté dans le README (une transform de
 * positionnement inline sur un élément qui porte aussi une keyframe
 * `transform` se fait écraser) impose de isoler la rotation dans un `<g>`
 * dédié — un détail propre à cette landing, pas au composant partagé.
 */
export function OrbitLogo({
  size = 30,
  strokeWidth = 2.4,
  dotR = 7.5,
  durationS = 24,
  spin = true,
}: {
  size?: number;
  strokeWidth?: number;
  dotR?: number;
  durationS?: number;
  /** Footer : marque statique, sans rotation. */
  spin?: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="10 7 66 66" fill="none" role="img" aria-label="nexus">
      <g
        style={{
          transformOrigin: '40px 40px',
          animation: spin ? `nx-spin ${durationS}s linear infinite` : undefined,
        }}
      >
        <ellipse
          cx="40"
          cy="40"
          rx="27"
          ry="10"
          stroke="#fff"
          strokeWidth={strokeWidth}
          opacity=".34"
        />
        <ellipse
          cx="40"
          cy="40"
          rx="27"
          ry="10"
          stroke="#fff"
          strokeWidth={strokeWidth}
          opacity=".34"
          transform="rotate(60 40 40)"
        />
        <ellipse
          cx="40"
          cy="40"
          rx="27"
          ry="10"
          stroke="#fff"
          strokeWidth={strokeWidth}
          opacity=".34"
          transform="rotate(120 40 40)"
        />
      </g>
      <circle cx="67" cy="40" r={dotR} fill="#007AFF" />
      <circle cx="26.5" cy="63.4" r={dotR} fill="#34C759" />
      <circle cx="26.5" cy="16.6" r={dotR} fill="#5856D6" />
    </svg>
  );
}
