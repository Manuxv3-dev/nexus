/**
 * FeatureShell — layout partagé par les 4 dashboards killer features
 * (Events, Polls, Expenses, Todos), rendu **dans le panel main** du
 * 3-pane AppShell (pas plein écran).
 *
 * Cf. ADR-020 + mockup validé 2026-05-01.
 *
 * Structure (rendu dans la zone main du AppShell) :
 *   ┌─ Header : icône + titre/sous-titre + Action primaire ┐
 *   ├─ Filters : chips statut/canal/tags                    │
 *   ├─ Content : vue principale du dashboard                │
 *   └────────────────────────────────────────────────────────┘
 *
 * Note : pas de bouton "← retour au chat" dans le shell — l'utilisateur
 * revient au chat en cliquant sur l'icône feature active dans le rail
 * (toggle), ce qui est géré par le AppShell parent.
 */
import { type ReactNode } from 'react';

import { Button, PhIcon, type PhIconName } from '@/components/ui';
import { NX } from '@/lib/tokens';

import { topBandOffset, useAtWindowTop } from '../app/TitleBar';

export interface FeatureShellProps {
  iconName: PhIconName;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle?: string;
  /**
   * Action primaire optionnelle.
   *
   * Décision 2026-05-03 : on ne rend PLUS de bouton "Nouvel item" dans le
   * header des dashboards (UI dupliquait la section "Créer rapidement" du
   * right rail). On garde la prop optionnelle pour permettre des cas
   * spécifiques futurs (export, settings de feature, etc.).
   */
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  /** Barre de filtres rendue sous le header (chips). */
  filters?: ReactNode;
  /** Contenu principal du dashboard. */
  children: ReactNode;
}

export function FeatureShell({
  iconName,
  iconColor,
  iconBg,
  title,
  subtitle,
  primaryAction,
  filters,
  children,
}: FeatureShellProps) {
  const atWindowTop = useAtWindowTop();

  return (
    <div
      // Animation d'entrée mutualisée pour les 4 dashboards orga (Events/
      // Polls/Expenses/Todos) qui montent tous FeatureShell — cf. MAN-112
      // Task 1. `prefers-reduced-motion` est déjà neutralisé globalement
      // (global.css) sans classe `!important` ici qui le court-circuiterait.
      className="animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        color: NX.fg,
      }}
    >
      <header
        // Au ras du haut de window (zone main d'`AppShell`) : le header porte la
        // drag region — Tauri exclut seul les contrôles de son sous-arbre — et
        // dégage la bande du cluster fenêtre, sous lequel tombe son action de
        // droite. Sous `MobileShell` il est rendu sous le header du stack
        // detail, donc ni l'un ni l'autre.
        {...(atWindowTop ? { 'data-tauri-drag-region': 'deep' } : {})}
        style={{
          padding: `${atWindowTop ? topBandOffset(NX.spaceDashboard) : NX.spaceDashboard}px ${NX.spaceDashboardLg}px ${NX.spaceDashboard - 4}px`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          borderBottom: `0.5px solid ${NX.border}`,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: iconBg,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PhIcon name={iconName} size={20} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>{title}</div>
          {subtitle ? (
            <div style={{ fontSize: 12, color: NX.fgMuted, marginTop: 2 }}>{subtitle}</div>
          ) : null}
        </div>

        {primaryAction ? (
          <Button onClick={primaryAction.onClick} variant="primary" size="sm">
            <PhIcon name="plus" size={13} />
            <span style={{ marginLeft: 6 }}>{primaryAction.label}</span>
          </Button>
        ) : null}
      </header>

      {filters ? (
        <div
          style={{
            padding: `${NX.spaceDashboard - 8}px ${NX.spaceDashboardLg}px`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            borderBottom: `0.5px solid ${NX.border}`,
          }}
        >
          {filters}
        </div>
      ) : null}

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: `${NX.spaceDashboard}px ${NX.spaceDashboardLg}px ${NX.spaceDashboardLg}px`,
        }}
      >
        {children}
      </main>
    </div>
  );
}

// ─────────────────────────── Sous-composants partagés ───────────────────

export interface FilterChipProps {
  label: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
  /** Couleur d'accent (canal source, tag) — affiché en pastille gauche. */
  accentColor?: string;
  accentBg?: string;
}

/**
 * Chip filtre standard utilisé dans la barre de filtres. Variants :
 *   - `active` : fond plein, fg lisible
 *   - `inactive` (default) : transparent + border
 *   - avec `accentColor` : pastille à gauche pour les canaux/tags
 */
export function FilterChip({
  label,
  active = false,
  count,
  onClick,
  accentColor,
  accentBg,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: NX.radiusPill,
        background: active ? NX.elevated : (accentBg ?? 'transparent'),
        border: `0.5px solid ${active ? 'transparent' : NX.border}`,
        color: active ? NX.fg : (accentColor ?? NX.fgMuted),
        fontSize: 12,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 150ms',
      }}
      onMouseEnter={(e) => {
        if (!active && onClick) {
          e.currentTarget.style.borderColor = NX.borderHover;
        }
      }}
      onMouseLeave={(e) => {
        if (!active && onClick) {
          e.currentTarget.style.borderColor = NX.border;
        }
      }}
    >
      {accentColor ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: accentColor,
            flexShrink: 0,
          }}
          aria-hidden
        />
      ) : null}
      {label}
      {count !== undefined ? (
        <span style={{ color: active ? NX.fgMuted : NX.fgDim, fontWeight: 500 }}>· {count}</span>
      ) : null}
    </button>
  );
}

/**
 * Séparateur vertical pour la barre de filtres (entre groupes de chips).
 */
export function FilterDivider() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 1,
        height: 18,
        background: NX.border,
        margin: '0 4px',
      }}
    />
  );
}
