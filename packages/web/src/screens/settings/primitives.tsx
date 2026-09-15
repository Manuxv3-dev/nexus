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
import type { PhIconName } from '@/components/ui';
import { NX } from '@/lib/tokens';

/**
 * Les 5 onglets de `/settings` — source unique pour le rail desktop
 * (`SidebarLink` en `.map()` dans `SettingsScreen.tsx`) ET la liste mobile
 * pleine largeur (`SettingsSectionsList` dans `SettingsScreen.mobile.tsx`,
 * ticket f0ebfd17). Vit ici (feuille sans dépendance vers une autre section,
 * cf. JSDoc de fichier) pour que les deux consommateurs puissent l'importer
 * sans créer de cycle entre eux. `Section` est dérivé de ce tableau plutôt que
 * défini à côté : une seule liste à tenir à jour pour ajouter/renommer un
 * onglet.
 */
export const SETTINGS_SECTIONS = [
  { key: 'profile', icon: 'users', label: 'Profil' },
  // Toujours visible, quel que soit le rôle du viewer dans ses groupes —
  // aucune condition de gating sur cet onglet (MAN-192, point de spec
  // explicite).
  { key: 'groups', icon: 'usersThree', label: 'Groupes' },
  { key: 'notifications', icon: 'bell', label: 'Notifications' },
  { key: 'connections', icon: 'link', label: 'Connexions messageries' },
  { key: 'security', icon: 'gear', label: 'Sécurité' },
] as const satisfies { key: string; icon: PhIconName; label: string }[];

export type Section = (typeof SETTINGS_SECTIONS)[number]['key'];

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
      // Réglages est une route plein écran, hors `AppShell` : ce titre est ce
      // qu'il y a de plus haut dans la zone principale, et sans lui la fenêtre
      // desktop n'y était déplaçable nulle part. `deep` : tout le bandeau
      // déplace, `action` (un bouton) reste cliquable — Tauri l'exclut.
      data-tauri-drag-region="deep"
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
