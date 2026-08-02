import type { CSSProperties, ReactNode } from 'react';

import { LX } from '../tokens';

import { Reveal } from './Reveal';

/** En-tête "label mono + H2 (gauche) / paragraphe (droite)" — Produit, Intégrations. */
export function SectionHeader({
  eyebrow,
  title,
  description,
  titleMaxWidth,
  titleStyle,
  descMaxWidth = 330,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  titleMaxWidth: number;
  titleStyle?: CSSProperties;
  descMaxWidth?: number;
}) {
  return (
    <Reveal>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 48,
          flexWrap: 'wrap',
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
            {eyebrow}
          </div>
          <h2
            style={{
              margin: '16px 0 0',
              maxWidth: titleMaxWidth,
              fontSize: 54,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: '-.045em',
              textWrap: 'balance',
              color: LX.text,
              ...titleStyle,
            }}
          >
            {title}
          </h2>
        </div>
        <p
          style={{
            margin: '0 0 8px',
            maxWidth: descMaxWidth,
            fontSize: 15.5,
            lineHeight: 1.6,
            color: LX.text3,
            textWrap: 'pretty',
          }}
        >
          {description}
        </p>
      </div>
    </Reveal>
  );
}
