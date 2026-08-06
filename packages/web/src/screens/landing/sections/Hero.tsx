import { MagneticButton } from '../components/MagneticButton';
import { OrbitRing } from '../components/OrbitRing';
import { PlatformChip } from '../components/PlatformChip';
import { useViewport } from '../hooks/useViewport';
import { LX } from '../tokens';

import { HeroMockup } from './HeroMockup';

const NX_UP = (delayS: number, durationS = 0.7) =>
  `nx-up ${durationS}s ${delayS}s cubic-bezier(.2,.8,.2,1) both`;

const CHIPS: {
  brand: 'discord' | 'whatsapp' | 'telegram' | 'messenger' | 'teams' | 'instagram';
  color: string;
  label: string;
  position: React.CSSProperties;
  floatDurationS: number;
  floatDelayS?: number;
}[] = [
  {
    brand: 'discord',
    color: '#5865F2',
    label: 'Discord',
    position: { left: 70, top: 34 },
    floatDurationS: 5.6,
  },
  {
    brand: 'whatsapp',
    color: '#25D366',
    label: 'WhatsApp',
    position: { left: 32, top: 150 },
    floatDurationS: 6.4,
    floatDelayS: 0.5,
  },
  {
    brand: 'telegram',
    color: '#229ED9',
    label: 'Telegram',
    position: { left: 88, top: 262 },
    floatDurationS: 5.2,
    floatDelayS: 1,
  },
  {
    brand: 'messenger',
    color: '#0084FF',
    label: 'Messenger',
    position: { right: 74, top: 30 },
    floatDurationS: 6,
    floatDelayS: 0.3,
  },
  {
    brand: 'teams',
    color: '#6264A7',
    label: 'Teams',
    position: { right: 36, top: 146 },
    floatDurationS: 5.4,
    floatDelayS: 0.8,
  },
  {
    brand: 'instagram',
    color: '#E4405F',
    label: 'Instagram',
    position: { right: 92, top: 258 },
    floatDurationS: 6.2,
    floatDelayS: 1.3,
  },
];

export function Hero({ onDownload, onDemo }: { onDownload: () => void; onDemo: () => void }) {
  const tier = useViewport();
  const isMobile = tier === 'mobile';
  const isDesktop = tier === 'desktop';

  const h1Size = isDesktop ? 76 : tier === 'tablet' ? 56 : 40;
  const mockupScale = isDesktop ? 0.94 : tier === 'tablet' ? 0.78 : 0.56;
  const sceneHeight = isDesktop ? 430 : tier === 'tablet' ? 360 : 250;

  return (
    <section style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Grille de fond, animée en dérive continue, masquée en ellipse — plein bord */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.032) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.032) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 74% 58% at 50% 44%, #000 16%, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse 74% 58% at 50% 44%, #000 16%, transparent 76%)',
          animation: 'nx-drift 16s linear infinite',
        }}
      />
      {/* Halo */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: 220,
          width: 1100,
          height: 700,
          transform: 'translateX(-50%)',
          background:
            'radial-gradient(ellipse at center, rgba(88,86,214,.28), rgba(0,122,255,.12) 44%, transparent 68%)',
          filter: 'blur(24px)',
        }}
      />

      {/* Contenu contenu à la largeur de conception (cf. LX.maxWidth) */}
      <div style={{ position: 'relative', maxWidth: LX.maxWidth, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: isMobile ? '48px 20px 0' : '66px 40px 0',
          }}
        >
          <h1
            style={{
              margin: '26px 0 0',
              maxWidth: 880,
              fontSize: h1Size,
              lineHeight: 0.98,
              fontWeight: 800,
              letterSpacing: '-.05em',
              textWrap: 'balance',
              animation: NX_UP(0.08),
              color: LX.text,
            }}
          >
            Tes amis sont partout.
            <br />
            <span
              style={{
                background:
                  'linear-gradient(100deg, #fff 16%, #8fb6ff 42%, #7ee0a0 60%, #c4a0ff 84%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Vos plans, ici.
            </span>
          </h1>

          <p
            style={{
              margin: '22px 0 0',
              maxWidth: 540,
              fontSize: isMobile ? 15.5 : 17.5,
              lineHeight: 1.55,
              color: LX.text3,
              textWrap: 'pretty',
              animation: NX_UP(0.16),
            }}
          >
            Branche Discord, WhatsApp, Messenger et 9 autres à un seul groupe — puis gère events,
            sondages, dépenses et ToDo sans jamais changer d&apos;app.
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: 'center',
              gap: 12,
              marginTop: 30,
              width: isMobile ? '100%' : undefined,
              animation: NX_UP(0.24),
            }}
          >
            <MagneticButton
              onClick={onDownload}
              style={{
                padding: '15px 28px',
                fontSize: 15,
                width: isMobile ? '100%' : undefined,
                justifyContent: 'center',
              }}
            >
              Télécharger l&apos;app
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 2v9m0 0 3.5-3.5M8 11 4.5 7.5M2.5 13.5h11"
                  stroke={LX.bg}
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </MagneticButton>
            <button
              type="button"
              onClick={onDemo}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                padding: '15px 24px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,.15)',
                background: 'transparent',
                color: 'rgba(255,255,255,.85)',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                width: isMobile ? '100%' : undefined,
                transition: 'background .2s, border-color .2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,.07)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)';
              }}
            >
              Voir la démo{' '}
              <span
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: LX.text4 }}
              >
                2 min
              </span>
            </button>
          </div>

          <div
            style={{
              marginTop: 18,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: isMobile ? 9.5 : 11,
              letterSpacing: '.06em',
              color: LX.text4,
              textAlign: 'center',
              animation: NX_UP(0.3),
            }}
          >
            GRATUIT · MACOS · WINDOWS · IOS · ANDROID
          </div>
        </div>

        <div style={{ position: 'relative', height: sceneHeight, marginTop: 20 }}>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              top: 120 * mockupScale,
              width: 700,
              height: 700,
              transform: 'translate(-50%,-50%)',
              zIndex: 0,
              pointerEvents: 'none',
            }}
          >
            <OrbitRing size={700} durationS={46} />
          </div>

          {!isMobile && CHIPS.map((chip) => <PlatformChip key={chip.brand} {...chip} />)}

          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 30,
              width: 580,
              transform: `translateX(-50%) scale(${mockupScale})`,
              transformOrigin: 'top center',
              zIndex: 1,
              filter: 'blur(.7px)',
            }}
          >
            <div style={{ animation: NX_UP(0.34, 0.9) }}>
              <HeroMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
