/**
 * DashboardLayout / DashboardRail — grille « contenu principal + rail droit »
 * partagée par les 4 dashboards orga (Events, Polls, Expenses, Todos), avec
 * repli réel du rail sous le point de rupture.
 *
 * Avant MAN-246 phase 5, chacun des 4 dashboards posait sa propre copie de
 * `minmax(0, 1fr) 340px`, et le seul repli existant était une règle CSS morte
 * dans le `<style>` d'EventsDashboard (`.events-rail`, classe que plus aucun
 * élément ne portait depuis que le rail est devenu un `<div style={...}>`).
 * Résultat : sur `MobileShell` → `DetailScreen`, la colonne de 340 px n'était
 * jamais repliée et `QuickCreate` sortait de l'écran — or c'est la SEULE
 * affordance de création depuis que `FeatureShell` ne rend plus de bouton
 * d'action primaire (décision 2026-05-03, cf. son JSDoc).
 *
 * Le repli **empile** donc le rail sous le contenu au lieu de le masquer : sur
 * l'état vide — le cas exact où l'UI invite à « créer le premier » — le bloc de
 * création se retrouve immédiatement sous un contenu court, donc visible.
 * Masquer le rail aurait fait disparaître la seule façon de créer un item.
 *
 * Le point de rupture reprend celui qu'annonçait déjà le JSDoc des 4
 * dashboards (« Right rail 340px ≥1280px »), et la convention `.98` de
 * `useIsMobile` (`lib/useMedia.ts`) pour ne pas laisser de trou à la borne.
 */
import { type CSSProperties, type ReactNode } from 'react';

import { useMedia } from '@/lib/useMedia';

/** Largeur minimale à partir de laquelle le rail droit tient à côté du contenu. */
export const RAIL_BREAKPOINT_PX = 1280;

/** Vrai en dessous du point de rupture — le rail passe alors dans le flux. */
export const RAIL_COLLAPSE_QUERY = `(max-width: ${RAIL_BREAKPOINT_PX - 0.02}px)`;

/**
 * Les deux composants observent la même query plutôt que de se passer l'état :
 * `useMedia` lit `matchMedia`, source unique et externe, donc ils ne peuvent
 * pas diverger — et le rail reste posable sans contexte à câbler.
 */
const useRailCollapsed = () => useMedia(RAIL_COLLAPSE_QUERY);

/** Grille du dashboard : contenu principal puis `DashboardRail`. */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const collapsed = useRailCollapsed();

  return (
    <div data-testid="dashboard-layout" style={collapsed ? stackedLayout : sideBySideLayout}>
      {children}
    </div>
  );
}

/** Rail droit : sticky à côté du contenu, empilé dans le flux une fois replié. */
export function DashboardRail({ children }: { children: ReactNode }) {
  const collapsed = useRailCollapsed();

  return <div style={collapsed ? stackedRail : stickyRail}>{children}</div>;
}

const baseLayout: CSSProperties = {
  display: 'grid',
  gap: 20,
  alignItems: 'start',
};

const sideBySideLayout: CSSProperties = {
  ...baseLayout,
  gridTemplateColumns: 'minmax(0, 1fr) 340px',
};

const stackedLayout: CSSProperties = {
  ...baseLayout,
  gridTemplateColumns: 'minmax(0, 1fr)',
};

const baseRail: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const stickyRail: CSSProperties = {
  ...baseRail,
  position: 'sticky',
  top: 16,
};

/**
 * Empilé, le rail défile avec le contenu : un `position: sticky` le collerait
 * en haut du viewport par-dessus la colonne principale.
 */
const stackedRail: CSSProperties = baseRail;
