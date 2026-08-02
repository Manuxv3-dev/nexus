import type { CSSProperties, ReactNode } from 'react';

import { useReveal } from '../hooks/useReveal';

/**
 * Wrapper de révélation au scroll (cf. `useReveal`). `delay` en secondes —
 * utiliser `cascadeDelay(index)` pour les grilles de cartes.
 *
 * L'état initial (opacity/transform) est posé en JS via le style calculé
 * ci-dessous, pas en CSS statique — la page reste lisible sans JS
 * (cf. README). `prefers-reduced-motion` est géré globalement par
 * `global.css` (transitions forcées quasi-instantanées).
 */
export function Reveal({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: CSSProperties;
}) {
  const { ref, inView } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(26px)',
        transition: `opacity .8s ${delay}s cubic-bezier(.2,.8,.2,1), transform .8s ${delay}s cubic-bezier(.2,.8,.2,1)`,
        willChange: inView ? undefined : 'opacity, transform',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
