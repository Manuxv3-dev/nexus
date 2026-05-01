import type { ReactNode } from 'react';

import { Avatar, PhIcon, type PhIconName } from '@/components/ui';
import { NX } from '@/lib/tokens';

export function FeatureHeader({
  icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  action,
}: {
  icon: PhIconName;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${NX.border}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: iconBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhIcon name={icon} size={22} color={iconColor} />
          </div>
          <div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: NX.fg,
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <div style={{ fontSize: 12, color: NX.fgDim, marginTop: 3 }}>{subtitle}</div>
            )}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}

export function CopyLinkButton({ slug, kind }: { slug: string; kind: 'e' | 'p' | 'd' | 't' | 'l' }) {
  const handleClick = async () => {
    const url = `${window.location.origin}/${kind}/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.warn('[copy] clipboard indispo', err);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      style={{
        background: NX.elevated,
        border: `1px solid ${NX.border}`,
        borderRadius: NX.radiusPill,
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        color: NX.fgMuted,
        fontSize: 12,
      }}
    >
      <PhIcon name="link" size={14} color={NX.fgMuted} />
      Copier le lien
    </button>
  );
}

export function PersonRow({
  name,
  size = 26,
  right,
}: {
  name: string;
  size?: number;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <Avatar name={name} size={size} />
      <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>{name}</span>
      {right}
    </div>
  );
}

export function PanelRoot({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      {children}
    </div>
  );
}

export function PanelEmpty({
  title,
  hint,
}: {
  title: string;
  hint?: ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
        color: NX.fgDim,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: NX.fg }}>{title}</div>
        {hint && <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
      </div>
    </div>
  );
}
