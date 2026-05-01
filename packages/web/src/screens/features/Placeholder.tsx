/**
 * Placeholder partagé — empty state utilisé tant que les vrais dashboards
 * features ne sont pas branchés sur la DB Drizzle.
 */
import { PhIcon } from '@/components/ui';
import { NX } from '@/lib/tokens';

export interface PlaceholderProps {
  title: string;
  description: string;
}

export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div
      style={{
        minHeight: 400,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 48,
        background: NX.surface,
        border: `0.5px dashed ${NX.borderHover}`,
        borderRadius: NX.radius,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: NX.elevated,
          color: NX.fgMuted,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <PhIcon name="sparkle" size={26} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 500, color: NX.fg, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: NX.fgMuted, maxWidth: 480, lineHeight: 1.6 }}>
        {description}
      </div>
    </div>
  );
}
