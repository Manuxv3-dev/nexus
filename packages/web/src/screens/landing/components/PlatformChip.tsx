import type { CSSProperties } from 'react';

import { BrandIcon, type BrandKey } from '@/components/ui';

import { brandTint } from './brandTint';

/**
 * Chip flottante "Discord" / "WhatsApp" / etc. de la scène du hero.
 *
 * Le wrapper `position` (statique) et l'enfant `nx-float` (animé) sont bien
 * séparés — cf. le piège documenté dans le README : une transform de
 * positionnement inline sur un élément qui porte aussi une keyframe
 * `transform` se fait écraser par la keyframe.
 */
export function PlatformChip({
  brand,
  color,
  label,
  position,
  floatDurationS,
  floatDelayS = 0,
}: {
  brand: BrandKey;
  color: string;
  label: string;
  position: CSSProperties;
  floatDurationS: number;
  floatDelayS?: number;
}) {
  return (
    <div style={{ position: 'absolute', zIndex: 4, ...position }}>
      <div
        style={{ animation: `nx-float ${floatDurationS}s ease-in-out ${floatDelayS}s infinite` }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '9px 15px 9px 11px',
            borderRadius: 14,
            background: brandTint(color, 0.14),
            border: `1px solid ${brandTint(color, 0.42)}`,
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              display: 'flex',
              width: 16,
              height: 16,
              borderRadius: 5,
              overflow: 'hidden',
              filter: `drop-shadow(0 0 6px ${brandTint(color, 0.7)})`,
            }}
          >
            <BrandIcon brand={brand} size={16} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.9)' }}>
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
