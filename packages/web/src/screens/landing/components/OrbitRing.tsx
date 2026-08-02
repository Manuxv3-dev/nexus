/** Grand anneau décoratif derrière le mockup du hero — pas la marque, un pur effet de fond. */
export function OrbitRing({ size = 700, durationS = 46 }: { size?: number; durationS?: number }) {
  const gradId = `nx-orbit-gradient-${size}`;
  return (
    <div
      style={{ width: '100%', height: '100%', animation: `nx-spin ${durationS}s linear infinite` }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 80 80"
        fill="none"
        style={{ overflow: 'visible' }}
        aria-hidden
      >
        <ellipse cx="40" cy="40" rx="27" ry="10" stroke={`url(#${gradId})`} strokeWidth=".45" />
        <ellipse
          cx="40"
          cy="40"
          rx="27"
          ry="10"
          stroke={`url(#${gradId})`}
          strokeWidth=".45"
          transform="rotate(60 40 40)"
        />
        <ellipse
          cx="40"
          cy="40"
          rx="27"
          ry="10"
          stroke={`url(#${gradId})`}
          strokeWidth=".45"
          transform="rotate(120 40 40)"
        />
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="80" y2="80">
            <stop stopColor="#fff" stopOpacity=".3" />
            <stop offset="1" stopColor="#fff" stopOpacity=".05" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
