import type { ReactNode } from 'react';

import { NX } from '@/lib/tokens';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div
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
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          position: 'relative',
          animation: 'fadeUp 0.5s ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}
