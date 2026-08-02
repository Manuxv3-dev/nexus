import type { CSSProperties } from 'react';

import { BrandIcon, type BrandKey } from '@/components/ui';

import { Reveal } from '../components/Reveal';
import { SectionHeader } from '../components/SectionHeader';
import { cascadeDelay } from '../hooks/useReveal';
import { useViewport } from '../hooks/useViewport';
import { LX } from '../tokens';

interface Platform {
  brand: BrandKey;
  label: string;
  connected: boolean;
  hoverBorder: string;
  hoverBg: string;
  /** X et TikTok : glyphe quasi-noir illisible sur le fond sombre de la tuile (cf. README). */
  monoIcon?: boolean;
}

const PLATFORMS: Platform[] = [
  {
    brand: 'discord',
    label: 'Discord',
    connected: true,
    hoverBorder: 'rgba(88,101,242,.5)',
    hoverBg: 'rgba(88,101,242,.08)',
  },
  {
    brand: 'whatsapp',
    label: 'WhatsApp',
    connected: true,
    hoverBorder: 'rgba(37,211,102,.5)',
    hoverBg: 'rgba(37,211,102,.08)',
  },
  {
    brand: 'messenger',
    label: 'Messenger',
    connected: true,
    hoverBorder: 'rgba(0,132,255,.5)',
    hoverBg: 'rgba(0,132,255,.08)',
  },
  {
    brand: 'teams',
    label: 'Microsoft Teams',
    connected: true,
    hoverBorder: 'rgba(91,95,199,.5)',
    hoverBg: 'rgba(91,95,199,.08)',
  },
  {
    brand: 'telegram',
    label: 'Telegram',
    connected: false,
    hoverBorder: 'rgba(41,169,235,.5)',
    hoverBg: 'rgba(41,169,235,.08)',
  },
  {
    brand: 'instagram',
    label: 'Instagram',
    connected: false,
    hoverBorder: 'rgba(225,48,108,.5)',
    hoverBg: 'rgba(225,48,108,.08)',
  },
  {
    brand: 'reddit',
    label: 'Reddit',
    connected: false,
    hoverBorder: 'rgba(255,69,0,.5)',
    hoverBg: 'rgba(255,69,0,.08)',
  },
  {
    brand: 'snapchat',
    label: 'Snapchat',
    connected: false,
    hoverBorder: 'rgba(255,252,0,.4)',
    hoverBg: 'rgba(255,252,0,.06)',
  },
  {
    brand: 'slack',
    label: 'Slack',
    connected: false,
    hoverBorder: 'rgba(74,21,75,.6)',
    hoverBg: 'rgba(74,21,75,.14)',
  },
  {
    brand: 'linkedin',
    label: 'LinkedIn',
    connected: false,
    hoverBorder: 'rgba(10,102,194,.5)',
    hoverBg: 'rgba(10,102,194,.08)',
  },
  {
    brand: 'twitter',
    label: 'X',
    connected: false,
    hoverBorder: 'rgba(255,255,255,.3)',
    hoverBg: 'rgba(255,255,255,.06)',
    monoIcon: true,
  },
  {
    brand: 'tiktok',
    label: 'TikTok',
    connected: false,
    hoverBorder: 'rgba(255,0,80,.4)',
    hoverBg: 'rgba(255,0,80,.07)',
    monoIcon: true,
  },
];

/**
 * #nx-integrations — grille des plateformes. Cf. README §5.
 * 4 colonnes desktop, 3 en tablette, 2 en mobile.
 */
export function Integrations() {
  const tier = useViewport();
  const isMobile = tier === 'mobile';
  const columns = tier === 'desktop' ? 4 : tier === 'tablet' ? 3 : 2;

  return (
    <div
      id="nx-integrations"
      style={{
        position: 'relative',
        padding: isMobile ? '72px 20px 0' : '110px 44px 0',
        scrollMarginTop: 24,
      }}
    >
      <div style={{ maxWidth: LX.maxWidth, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="03 — INTÉGRATIONS"
          title="Douze plateformes, une seule liste d’amis"
          titleMaxWidth={600}
          description="Tes conversations restent chez elles. Nexus ne fait que les rassembler dans une vue unique."
          descMaxWidth={310}
        />

        <Reveal>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: 12,
              marginTop: 44,
            }}
          >
            {PLATFORMS.map((p, i) => (
              <PlatformTile key={p.brand} platform={p} delay={cascadeDelay(i)} />
            ))}
          </div>
        </Reveal>

        <Reveal>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              marginTop: 20,
              padding: '16px 20px',
              borderRadius: 14,
              background: 'rgba(52,199,89,.06)',
              border: '1px solid rgba(52,199,89,.2)',
              fontSize: 14,
              color: 'rgba(255,255,255,.65)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                borderRadius: 99,
                background: 'rgba(52,199,89,.2)',
                flexShrink: 0,
              }}
            >
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path
                  d="M1 4l2.6 2.6L9 1.2"
                  stroke="#34C759"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            Chiffré de bout en bout. Nexus ne stocke aucun message — tout transite, rien ne reste.
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function PlatformTile({ platform: p, delay }: { platform: Platform; delay: number }) {
  const baseStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    background: 'rgba(255,255,255,.03)',
    border: `1px solid ${LX.border}`,
    cursor: 'pointer',
    transition: 'transform .22s cubic-bezier(.2,.8,.2,1), border-color .22s, background .22s',
  };

  return (
    <Reveal delay={delay}>
      <div
        style={baseStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-3px)';
          e.currentTarget.style.borderColor = p.hoverBorder;
          e.currentTarget.style.background = p.hoverBg;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = '';
          e.currentTarget.style.borderColor = LX.border;
          e.currentTarget.style.background = 'rgba(255,255,255,.03)';
        }}
      >
        {p.monoIcon ? (
          <BrandIcon brand={p.brand} size={32} colored={false} style={{ color: '#fff' }} />
        ) : (
          <BrandIcon brand={p.brand} size={32} />
        )}
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: LX.text }}>{p.label}</div>
          <div style={{ fontSize: 11, color: p.connected ? '#5fdc86' : LX.text4 }}>
            {p.connected ? 'Connecté' : 'Disponible'}
          </div>
        </div>
      </div>
    </Reveal>
  );
}
