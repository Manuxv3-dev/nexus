import type { ReactNode } from 'react';

import { NX } from '@/lib/tokens';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    // Animation d'entrée portée par le wrapper racine, pas par la carte : le
    // formulaire doit rester immédiatement cliquable/saisissable pendant la
    // transition (pas de `pointer-events:none`, cf. `prefers-reduced-motion`
    // géré globalement par `styles/global.css:92`).
    <div
      className="animate-in fade-in slide-in-from-bottom-4 duration-500"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        position: 'relative',
        background: NX.bg,
      }}
    >
      {/* Halo violet de fond */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,92,252,0.08) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      {/* Carte de formulaire — profondeur via tokens glass/shadow (ADR-021). */}
      <div
        data-testid="auth-card"
        style={{
          width: '100%',
          maxWidth: 400,
          position: 'relative',
          background: NX.glassBg,
          backdropFilter: NX.glassBlur,
          WebkitBackdropFilter: NX.glassBlur,
          border: `1px solid ${NX.glassBorder}`,
          boxShadow: NX.shadowMd,
          borderRadius: NX.radiusXl,
          padding: '32px 28px',
        }}
      >
        {children}
      </div>
    </div>
  );
}
