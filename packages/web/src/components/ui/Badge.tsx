import type { ReactNode } from 'react';

import { NX } from '@/lib/tokens';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'discord'
  | 'whatsapp'
  | 'messenger';

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: NX.border, fg: NX.fgDim },
  primary: { bg: NX.primaryMuted, fg: NX.primaryText },
  success: { bg: NX.successBg, fg: NX.success },
  warning: { bg: NX.warningBg, fg: NX.warning },
  error: { bg: NX.errorBg, fg: NX.error },
  info: { bg: NX.infoBg, fg: NX.info },
  discord: { bg: NX.discordBg, fg: NX.discord },
  whatsapp: { bg: NX.whatsappBg, fg: NX.whatsapp },
  messenger: { bg: NX.messengerBg, fg: NX.messenger },
};

export function Badge({
  children,
  tone = 'neutral',
  size = 'md',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  size?: 'sm' | 'md';
}) {
  const t = TONES[tone];
  const padding = size === 'sm' ? '2px 8px' : '3px 10px';
  const fontSize = size === 'sm' ? 10 : 11;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding,
        borderRadius: NX.radiusPill,
        background: t.bg,
        color: t.fg,
        fontSize,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
