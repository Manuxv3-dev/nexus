/**
 * Primitives visuelles partagées entre les sections de Settings —
 * extraites de `SettingsScreen.tsx` en MAN-192 (revue Phase 1) pour casser
 * un import circulaire : `GroupsSection.tsx` importait `Card`/`Divider`/
 * `SectionTitle` depuis `SettingsScreen.tsx`, qui importait lui-même
 * `GroupsSection` en retour. Ça ne fonctionnait qu'accidentellement grâce
 * au hoisting des déclarations `function` — un futur refactor (ex. passage
 * à des `const () =>`) aurait cassé le cycle en silence. Ce fichier n'a
 * aucune dépendance vers une autre section de Settings : c'est la feuille
 * de l'arbre d'imports, plus de cycle possible.
 */
import { NX } from '@/lib/tokens';

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ padding: '20px 24px', borderBottom: `1px solid ${NX.border}` }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: NX.fg }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: NX.fgDim, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '0 12px' }}>
      <div
        style={{
          background: NX.elevated,
          borderRadius: NX.radius,
          border: `1px solid ${NX.border}`,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Divider() {
  return <div style={{ height: 1, background: NX.border, margin: '0 16px' }} />;
}
