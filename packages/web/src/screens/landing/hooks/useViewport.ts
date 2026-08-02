import { useEffect, useState } from 'react';

export type ViewportTier = 'desktop' | 'tablet' | 'mobile';

function tierFromWidth(width: number): ViewportTier {
  if (width < 768) return 'mobile';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

/**
 * Palier responsive — cf. README §Responsive (non maquetté par le design,
 * recommandations suivies telles quelles) :
 *   - ≥1200px : desktop, tel quel.
 *   - 768–1199px : tablet.
 *   - <768px : mobile (nav burger, magnétisme/tilt désactivés).
 */
export function useViewport(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(() =>
    typeof window === 'undefined' ? 'desktop' : tierFromWidth(window.innerWidth),
  );

  useEffect(() => {
    const onResize = () => setTier(tierFromWidth(window.innerWidth));
    onResize();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return tier;
}
