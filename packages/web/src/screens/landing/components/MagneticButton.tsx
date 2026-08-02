import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useRef } from 'react';

import { LX } from '../tokens';

import { supportsHover } from './supportsHover';

/**
 * CTA primaire "magnétique" + effet sheen (bande lumineuse en boucle).
 * Cf. README §Interactions & Behavior — formule de décalage exacte :
 *   dx = (clientX - rect.left - rect.width/2)  * 0.22
 *   dy = (clientY - rect.top  - rect.height/2) * 0.34
 *
 * Mutation directe du DOM via ref plutôt que du state React : un
 * `mousemove` à 60fps ne doit pas déclencher de re-render.
 */
export function MagneticButton({
  children,
  onClick,
  style,
  className,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const ref = useRef<HTMLButtonElement>(null);

  const handleMove = (e: MouseEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el || !supportsHover()) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - rect.left - rect.width / 2) * 0.22;
    const dy = (e.clientY - rect.top - rect.height / 2) * 0.34;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`;
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    el.style.boxShadow = '';
  };

  const handleEnter = () => {
    const el = ref.current;
    if (!el) return;
    el.style.boxShadow = '0 14px 40px rgba(140,160,255,.4)';
  };

  return (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        borderRadius: 999,
        background: LX.text,
        color: LX.bg,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        cursor: 'pointer',
        overflow: 'hidden',
        border: 'none',
        transition: 'transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .25s',
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '38%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent)',
          animation: 'nx-sheen 3.6s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />
      {children}
    </button>
  );
}
