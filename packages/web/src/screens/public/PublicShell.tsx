import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Logo, PhIcon, type PhIconName } from '@/components/ui';
import { NX } from '@/lib/tokens';

export function PublicShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div
      style={{
        background: NX.bg,
        minHeight: '100vh',
        fontFamily: "'Inter', sans-serif",
        color: NX.fg,
      }}
    >
      <header
        style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${NX.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          type="button"
          onClick={() => void navigate({ to: '/' })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          <Logo size={22} />
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.04em', color: NX.fg }}>
            nexus
          </span>
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: '/app' })}
          style={{
            padding: '7px 16px',
            borderRadius: NX.radiusPill,
            background: NX.primary,
            color: '#fff',
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Ouvrir dans Nexus
        </button>
      </header>
      {children}
    </div>
  );
}

export function PublicHero({
  icon,
  iconColor,
  iconBg,
  type,
  groupName,
  title,
  meta,
  gradientFrom,
  gradientTo,
  bigValue,
}: {
  icon: PhIconName;
  iconColor: string;
  iconBg: string;
  type: string;
  groupName: string;
  title: string;
  meta?: ReactNode;
  gradientFrom: string;
  gradientTo: string;
  bigValue?: ReactNode;
}) {
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`,
        borderRadius: NX.radius,
        padding: '28px 24px',
        marginBottom: 20,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -30,
          right: -30,
          width: 120,
          height: 120,
          borderRadius: '50%',
          background: iconColor,
          opacity: 0.06,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PhIcon name={icon} size={24} color={iconColor} />
        </div>
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: iconColor,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            {type}
          </div>
          <div style={{ fontSize: 11, color: NX.fgDim }}>{groupName}</div>
        </div>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
        {title}
      </h1>
      {bigValue}
      {meta && <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 8 }}>{meta}</div>}
    </div>
  );
}

export function PublicCTAFooter() {
  const navigate = useNavigate();
  return (
    <div
      style={{
        fontSize: 11,
        color: NX.fgDim,
        marginTop: 12,
        textAlign: 'center',
        padding: '20px 0',
      }}
    >
      Tu n'as pas de compte ?{' '}
      <button
        type="button"
        onClick={() => void navigate({ to: '/register' })}
        style={{
          background: 'none',
          border: 'none',
          color: NX.primaryText,
          fontWeight: 600,
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        Créer un compte en 30s
      </button>
    </div>
  );
}
