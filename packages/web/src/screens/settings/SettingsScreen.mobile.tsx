/**
 * Variante mobile de `/settings` (ticket f0ebfd17) — extraite de
 * `SettingsScreen.tsx` pour ne pas alourdir davantage un fichier déjà long.
 *
 * `SettingsScreen.tsx` livrait un layout desktop en dur (rail de navigation
 * à 240px + contenu) : sous 768px, le rail mange la largeur et il ne reste
 * plus qu'une colonne de ~150px pour le contenu — inutilisable (cf. ticket).
 * Plutôt que de comprimer le layout à deux colonnes, on bascule vers une
 * navigation par stack à deux étapes, même registre que `MobileShell.tsx` :
 *
 *  1. {@link SettingsSectionsList} — la liste des 5 onglets en pleine largeur
 *     (mêmes libellés/icônes que le rail desktop), plus le bouton de sortie
 *     vers `/app` (rangée de marque "nexus", identique au rail desktop).
 *  2. {@link SettingsSectionDetail} — la section choisie en pleine largeur,
 *     avec un en-tête "‹ Réglages" qui revient à la liste. Le contenu de la
 *     section elle-même (`ProfileSection`, `GroupsSection`, etc.) est passé
 *     en `children` par `SettingsScreen.tsx` : ce fichier reste purement
 *     présentationnel, sans dépendre des sections individuelles ni du state
 *     `Section` de `SettingsScreen.tsx` au-delà du type — cf. import de
 *     `Section` depuis `./primitives`, pas depuis `./SettingsScreen`, pour ne
 *     pas réintroduire l'import circulaire que `primitives.tsx` existe déjà
 *     pour casser (cf. sa JSDoc de fichier).
 *
 * Conventions reprises de `MobileShell.tsx`/`TitleBar.tsx` : header
 * `data-tauri-drag-region="deep"` + `topBandOffset` pour rester déplaçable et
 * ne pas passer sous le cluster de boutons fenêtre en Tauri (fenêtre étroite
 * ou vrai mobile n'existe pas encore pour `/settings`, mais `ResponsiveAppShell`
 * bascule déjà `/app` vers `MobileShell` sur fenêtre Tauri étroite — même
 * bascule ici via `useIsMobile()` dans `SettingsScreen.tsx`).
 */
import type { ReactNode } from 'react';

import { Logo, PhIcon, type PhIconName } from '@/components/ui';
import { NX } from '@/lib/tokens';
import { topBandOffset } from '@/screens/app/TitleBar';

import { Card, Divider, type Section } from './primitives';

/**
 * Métadonnées des 5 onglets, mêmes libellés/icônes/ordre que les
 * `SidebarLink` du rail desktop (`SettingsScreen.tsx`). Pas de source unique
 * avec le rail desktop : celui-ci reste un JSX écrit à la main (pas de
 * régression de pixel voulue sur le layout desktop, cf. ticket) — dupliquer
 * ces 5 lignes est plus simple et moins risqué qu'y faire dépendre le rail
 * desktop d'un tableau partagé pour un gain marginal. À garder synchronisé si
 * un onglet est ajouté/renommé côté desktop.
 */
export const MOBILE_SETTINGS_SECTIONS: { key: Section; icon: PhIconName; label: string }[] = [
  { key: 'profile', icon: 'users', label: 'Profil' },
  { key: 'groups', icon: 'usersThree', label: 'Groupes' },
  { key: 'notifications', icon: 'bell', label: 'Notifications' },
  { key: 'connections', icon: 'link', label: 'Connexions messageries' },
  { key: 'security', icon: 'gear', label: 'Sécurité' },
];

/**
 * Étape 1 — liste des sections en pleine largeur. Remplace le rail desktop
 * (240px fixes) qui, sous 768px, ne laissait que ~150px de contenu.
 */
export function SettingsSectionsList({
  onSelect,
  onExit,
}: {
  onSelect: (key: Section) => void;
  /** Renvoie vers `/app` — même affordance que la rangée de marque du rail desktop. */
  onExit: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: NX.bg,
        color: NX.fg,
      }}
    >
      {/* Rangée de marque = prise de drag desktop, cf. même rangée dans le
          rail de `SettingsScreen.tsx`. Bouton descendant : la région ne
          bloque pas son clic (cf. JSDoc de `TitleBar`). */}
      <div
        data-tauri-drag-region="deep"
        style={{ display: 'flex', padding: `${topBandOffset(16)}px 16px 4px` }}
      >
        <button
          type="button"
          onClick={onExit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 6px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          <PhIcon name="caretLeft" size={16} color={NX.fgDim} />
          <Logo size={22} />
          <span style={{ fontSize: 14, fontWeight: 700, color: NX.fg, letterSpacing: '-0.04em' }}>
            nexus
          </span>
        </button>
      </div>

      <div style={{ fontSize: 20, fontWeight: 700, color: NX.fg, padding: '8px 20px 16px' }}>
        Réglages
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 24px' }}>
        <Card>
          {MOBILE_SETTINGS_SECTIONS.map((s, i, arr) => (
            <div key={s.key}>
              <button
                type="button"
                onClick={() => onSelect(s.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '14px 16px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'inherit',
                }}
              >
                <PhIcon name={s.icon} size={18} color={NX.fgDim} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: NX.fg }}>
                  {s.label}
                </span>
                <PhIcon name="caretRight" size={14} color={NX.fgGhost} />
              </button>
              {i < arr.length - 1 && <Divider />}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/**
 * Étape 2 — section choisie en pleine largeur. `children` est le rendu de la
 * section active telle que `SettingsScreen.tsx` la construit déjà pour le
 * layout desktop (`ProfileSection`, `GroupsSection`, etc., inchangées) : ce
 * composant se contente de l'encadrer d'un en-tête de retour.
 */
export function SettingsSectionDetail({
  onBack,
  children,
}: {
  /** Revient à la liste des sections (étape 1) — jamais vers `/app` directement. */
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: NX.bg,
        color: NX.fg,
      }}
    >
      <div
        data-tauri-drag-region="deep"
        style={{
          flexShrink: 0,
          padding: `${topBandOffset(12)}px 12px 12px`,
          borderBottom: `1px solid ${NX.border}`,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: NX.fgMuted,
            padding: 4,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <PhIcon name="caretLeft" size={18} color={NX.fgMuted} />
          Réglages
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
    </div>
  );
}
