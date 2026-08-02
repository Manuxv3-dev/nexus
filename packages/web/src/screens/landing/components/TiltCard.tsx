import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useRef } from 'react';

import { supportsHover } from './supportsHover';

/**
 * Tilt 3D au survol (cartes produit, cartes du mockup). Cf. README :
 *   px = (clientX-rect.left)/rect.width  - 0.5
 *   py = (clientY-rect.top )/rect.height - 0.5
 *   transform = perspective(900px) rotateX(-py*7deg) rotateY(px*9deg) translateZ(8px)
 */
export function TiltCard({
  children,
  style,
  className,
  hoverBorderColor,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  /** Bordure d'accent qui s'intensifie au survol (cf. README §3, ".2 → .5"). */
  hoverBorderColor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !supportsHover()) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${-py * 7}deg) rotateY(${px * 9}deg) translateZ(8px)`;
  };

  const handleEnter = () => {
    const el = ref.current;
    if (!el || !hoverBorderColor) return;
    el.style.borderColor = hoverBorderColor;
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    if (hoverBorderColor) el.style.borderColor = '';
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={className}
      style={{
        transformStyle: 'preserve-3d',
        transition: 'transform .16s ease-out, border-color .25s, background .25s',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
