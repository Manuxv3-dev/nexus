import { BrandIcon, type BrandKey } from '@/components/ui';

import { LX } from '../tokens';

const PLATFORMS: { brand: BrandKey; label: string; color: string }[] = [
  { brand: 'discord', label: 'Discord', color: '#5865F2' },
  { brand: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
  { brand: 'messenger', label: 'Messenger', color: '#0084FF' },
  { brand: 'teams', label: 'Teams', color: '#6264A7' },
  { brand: 'telegram', label: 'Telegram', color: '#229ED9' },
  { brand: 'instagram', label: 'Instagram', color: '#E4405F' },
  { brand: 'reddit', label: 'Reddit', color: '#FF4500' },
];

/**
 * Bandeau "Connecté à" — aucune bordure, fondu vertical symétrique
 * (demande explicite du client, cf. README §2).
 */
export function PlatformsBand() {
  return (
    <div
      style={{
        position: 'relative',
        background: 'linear-gradient(180deg, transparent, rgba(255,255,255,.035) 50%, transparent)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 34,
          maxWidth: LX.maxWidth,
          margin: '0 auto',
          padding: '30px 44px',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            letterSpacing: '.12em',
            color: LX.text4,
            whiteSpace: 'nowrap',
          }}
        >
          CONNECTÉ À
        </span>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            fontSize: 14,
            fontWeight: 600,
            flexWrap: 'wrap',
          }}
        >
          {PLATFORMS.map((p) => (
            <span
              key={p.brand}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: LX.text2,
                transition: 'color .2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = LX.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = LX.text2;
              }}
            >
              <BrandIcon brand={p.brand} size={15} />
              {p.label}
            </span>
          ))}
          <span style={{ color: LX.text5 }}>+ 5 autres</span>
        </div>
      </div>
    </div>
  );
}
