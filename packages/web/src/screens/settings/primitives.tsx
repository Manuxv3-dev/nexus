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

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  /**
   * Slot optionnel affiché à droite du titre, sur la même ligne (ex. le
   * bouton "Créer un groupe" de `GroupsSection`, MAN-194 Phase 3). Absent
   * par défaut : ne change rien pour les sections qui n'en fournissent pas.
   */
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: '20px 24px',
        borderBottom: `1px solid ${NX.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: NX.fg }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: NX.fgDim, marginTop: 4 }}>{subtitle}</div>}
      </div>
      {action}
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
