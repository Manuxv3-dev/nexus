import { useState } from 'react';

import { Reveal } from '../components/Reveal';
import { useViewport } from '../hooks/useViewport';
import { LX } from '../tokens';

const FAQ_ITEMS = [
  {
    q: 'Mes amis doivent-ils installer Nexus ?',
    a: "Non. Ils continuent d'utiliser Discord ou WhatsApp comme d'habitude — les events, sondages et rappels arrivent directement dans leur conversation. Nexus n'est indispensable qu'à celui qui organise.",
  },
  {
    q: 'Est-ce que vous lisez mes messages ?',
    a: "Non. Tout est chiffré de bout en bout et rien n'est conservé sur nos serveurs. Nexus relaie, affiche, puis oublie.",
  },
  {
    q: 'Sur quelles plateformes Nexus fonctionne ?',
    a: 'macOS, Windows, iOS et Android — plus une version web si tu ne veux rien installer. Tout se synchronise en temps réel.',
  },
  {
    q: 'Comment fonctionne le split de dépenses ?',
    a: 'Tu ajoutes une dépense, tu choisis qui participe, Nexus calcule les soldes et relance automatiquement. Aucun paiement ne transite par nous.',
  },
];

/**
 * #nx-faq — 4 accordéons. Contrôlés en React (pas de `<details>` natif) pour
 * animer la hauteur et faire pivoter le `+` en `×` à l'ouverture — le
 * `<details>` natif ne le fait pas (cf. README).
 */
export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const tier = useViewport();
  const isMobile = tier === 'mobile';
  const stacked = tier !== 'desktop';

  return (
    <div
      id="nx-faq"
      style={{
        position: 'relative',
        padding: isMobile ? '72px 20px 0' : '110px 44px 0',
        scrollMarginTop: 24,
      }}
    >
      <div style={{ maxWidth: LX.maxWidth, margin: '0 auto' }}>
        <Reveal>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: stacked ? '1fr' : '340px minmax(0,1fr)',
              gap: stacked ? 32 : 56,
              alignItems: 'start',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '.12em',
                  color: LX.text4,
                }}
              >
                04 — FAQ
              </div>
              <h2
                style={{
                  margin: '16px 0 0',
                  fontSize: 46,
                  lineHeight: 1.06,
                  fontWeight: 800,
                  letterSpacing: '-.045em',
                  color: LX.text,
                }}
              >
                Les questions qu&apos;on nous pose
              </h2>
              <p
                style={{
                  margin: '16px 0 0',
                  fontSize: 14.5,
                  lineHeight: 1.6,
                  color: 'rgba(255,255,255,.45)',
                }}
              >
                Une autre question ?{' '}
                <a
                  href="mailto:salut@nexusapp.chat"
                  style={{ color: '#7ea6ff', textDecoration: 'none' }}
                >
                  salut@nexusapp.chat
                </a>
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {FAQ_ITEMS.map((item, i) => (
                <FaqItem
                  key={item.q}
                  question={item.q}
                  answer={item.a}
                  isLast={i === FAQ_ITEMS.length - 1}
                  isOpen={openIndex === i}
                  onToggle={() => setOpenIndex(openIndex === i ? null : i)}
                />
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function FaqItem({
  question,
  answer,
  isLast,
  isOpen,
  onToggle,
}: {
  question: string;
  answer: string;
  isLast: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const contentId = `nx-faq-content-${question.length}-${question.slice(0, 8)}`;
  const isMobile = useViewport() === 'mobile';

  return (
    <div
      style={{
        borderTop: `1px solid ${LX.border}`,
        borderBottom: isLast ? `1px solid ${LX.border}` : undefined,
      }}
    >
      <h3 style={{ margin: 0 }}>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={onToggle}
          style={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            padding: '22px 4px',
            background: 'none',
            border: 'none',
            textAlign: 'left',
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: '-.015em',
            color: LX.text,
            cursor: 'pointer',
            transition: 'color .2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#8fb6ff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = LX.text;
          }}
        >
          {question}
          <span
            aria-hidden
            style={{
              flex: 'none',
              fontSize: 20,
              fontWeight: 400,
              color: 'rgba(255,255,255,.35)',
              transform: isOpen ? 'rotate(45deg)' : 'none',
              transition: 'transform .25s cubic-bezier(.2,.8,.2,1)',
            }}
          >
            +
          </span>
        </button>
      </h3>
      <div
        id={contentId}
        style={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows .3s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <p
            style={{
              margin: '0 0 22px',
              paddingRight: isMobile ? 0 : 60,
              fontSize: 15,
              lineHeight: 1.65,
              color: 'rgba(255,255,255,.52)',
            }}
          >
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
