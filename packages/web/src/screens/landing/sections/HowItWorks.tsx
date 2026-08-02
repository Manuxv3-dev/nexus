import { BrandIcon, type BrandKey } from '@/components/ui';

import { brandTint } from '../components/brandTint';
import { Reveal } from '../components/Reveal';
import { cascadeDelay } from '../hooks/useReveal';
import { useViewport } from '../hooks/useViewport';
import { LX } from '../tokens';

const STEPS = [
  {
    n: '01',
    title: 'Connecte tes messageries',
    text: 'Discord, WhatsApp, Messenger, Teams… Tu te connectes une fois, Nexus garde le lien ouvert.',
  },
  {
    n: '02',
    title: 'Crée ton groupe',
    text: 'Ajoute tes potes, peu importe l’appli sur laquelle ils sont. Ils reçoivent tout là où ils sont déjà.',
  },
  {
    n: '03',
    title: 'Organisez-vous',
    text: 'Events, sondages, dépenses, todos. Tout arrive dans la conversation, personne n’a rien à installer.',
  },
] as const;

const CARD_BASE = {
  position: 'relative' as const,
  padding: 26,
  borderRadius: 20,
  background: 'rgba(255,255,255,.028)',
  border: `1px solid ${LX.border}`,
  transition: 'border-color .3s, background .3s',
};

/**
 * Section "Comment ça marche" — 3 cartes numérotées. Cf. README §4.
 * <768px : 1 colonne.
 */
export function HowItWorks() {
  const tier = useViewport();
  const isMobile = tier === 'mobile';

  return (
    <div style={{ position: 'relative', padding: isMobile ? '72px 20px 0' : '110px 44px 0' }}>
      <div style={{ maxWidth: LX.maxWidth, margin: '0 auto' }}>
        <Reveal>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: '.12em',
                color: LX.text4,
              }}
            >
              02 — COMMENT ÇA MARCHE
            </div>
            <h2
              style={{
                margin: '16px auto 0',
                maxWidth: 620,
                fontSize: 52,
                lineHeight: 1.04,
                fontWeight: 800,
                letterSpacing: '-.045em',
                textWrap: 'balance',
                color: LX.text,
              }}
            >
              Trois minutes pour tout brancher
            </h2>
          </div>
        </Reveal>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 18,
            marginTop: 48,
          }}
        >
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={cascadeDelay(i)}>
              <StepCard step={step} />
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepCard({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <div
      style={CARD_BASE}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,.2)';
        e.currentTarget.style.background = 'rgba(255,255,255,.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = LX.border;
        e.currentTarget.style.background = 'rgba(255,255,255,.028)';
      }}
    >
      <div
        style={{
          fontSize: 44,
          fontWeight: 800,
          letterSpacing: '-.05em',
          color: 'rgba(255,255,255,.14)',
        }}
      >
        {step.n}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-.025em',
          color: LX.text,
        }}
      >
        {step.title}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 14.5, lineHeight: 1.6, color: LX.text3 }}>
        {step.text}
      </p>
      {step.n === '01' && <ConnectIllustration />}
      {step.n === '02' && <GroupIllustration />}
      {step.n === '03' && <OrganizeIllustration />}
    </div>
  );
}

const CONNECT_BRANDS: { brand: BrandKey; color: string }[] = [
  { brand: 'discord', color: '#5865F2' },
  { brand: 'whatsapp', color: '#25D366' },
  { brand: 'messenger', color: '#0084FF' },
  { brand: 'teams', color: '#6264A7' },
];

function ConnectIllustration() {
  return (
    <div style={{ display: 'flex', gap: 7, marginTop: 18 }}>
      {CONNECT_BRANDS.map((b) => (
        <span
          key={b.brand}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 8,
            background: brandTint(b.color, 0.16),
            border: `1px solid ${brandTint(b.color, 0.4)}`,
          }}
        >
          <BrandIcon brand={b.brand} size={15} />
        </span>
      ))}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: 8,
          border: '1px dashed rgba(255,255,255,.2)',
          color: LX.text4,
          fontSize: 13,
        }}
      >
        +
      </span>
    </div>
  );
}

const FRIENDS = [
  { initial: 'M', bg: '#f0a3c0', color: '#3a1226' },
  { initial: 'L', bg: '#a5c8f0', color: '#12263a' },
  { initial: 'K', bg: '#f0d0a3', color: '#3a2812' },
  { initial: 'T', bg: '#b8e6c4', color: '#123a20' },
];

function GroupIllustration() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
      {FRIENDS.map((f, i) => (
        <span
          key={f.initial}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 99,
            background: f.bg,
            color: f.color,
            fontSize: 11,
            fontWeight: 800,
            border: `2px solid ${LX.bg}`,
            marginLeft: i === 0 ? 0 : -9,
          }}
        >
          {f.initial}
        </span>
      ))}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 30,
          padding: '0 11px',
          borderRadius: 99,
          background: 'rgba(255,255,255,.09)',
          fontSize: 11.5,
          fontWeight: 700,
          border: `2px solid ${LX.bg}`,
          marginLeft: -9,
        }}
      >
        +3
      </span>
    </div>
  );
}

const MODULE_BARS = [
  'rgba(0,122,255,.28)',
  'rgba(168,85,247,.28)',
  'rgba(245,158,11,.28)',
  'rgba(52,199,89,.28)',
];

function OrganizeIllustration() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7, marginTop: 18 }}>
      {MODULE_BARS.map((bg) => (
        <span key={bg} style={{ height: 26, borderRadius: 8, background: bg }} />
      ))}
    </div>
  );
}
