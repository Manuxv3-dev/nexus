/**
 * Window controls pour nexus desktop (Tauri 2 borderless).
 *
 * Quand `decorations: false` côté tauri.conf.json, on perd la titlebar
 * système. Plutôt que de la remplacer par une barre dédiée (qui fait
 * double-emploi avec les headers du contenu), on intègre directement
 * les boutons fenêtre DANS la window via overlay flottant top-right.
 *
 * ## Pourquoi il n'y a PAS de drag region flottante ici
 *
 * Ce composant a longtemps posé, en plus des boutons, un calque invisible
 * `position:fixed` de 32 px de haut sur toute la largeur, porteur de
 * `data-tauri-drag-region`, pour permettre de déplacer la fenêtre depuis
 * n'importe où dans le bandeau supérieur. C'était un bug de zones de clic :
 * le calque interceptait le hit-test, donc tout contrôle rendu dans cette
 * bande (au premier chef le bouton « Home nexus » de la blade, recouvert sur
 * 24 de ses 34 px) ne recevait jamais le clic — la fenêtre se déplaçait à la
 * place.
 *
 * Le handler de Tauri (`src/window/scripts/drag.js`) sait pourtant ne pas
 * draguer depuis un élément cliquable (`A`, `BUTTON`, `INPUT`, `role`
 * interactif, `tabindex`…), mais il raisonne sur le `composedPath` — donc sur
 * l'**ascendance DOM**. Un calque flottant est un frère, pas un ancêtre : la
 * protection ne pouvait pas s'appliquer.
 *
 * La drag region vit donc désormais sur les conteneurs de header réels, via
 * `data-tauri-drag-region="deep"` — uniquement ceux dont on sait qu'ils sont
 * collés au haut de la window : le header de blade d'`AppShell` et les trois
 * headers de `MobileShell`. Étant ancêtres des contrôles qu'elles couvrent,
 * Tauri les exclut tout seul — aucune liste d'exclusion à maintenir.
 *
 * Deux garde-fous pour qui voudrait étendre ça :
 *  - Ne pas réintroduire de calque de drag flottant ici.
 *  - Ne jamais décorer en dur un header qui n'est pas garanti en haut de
 *    window. `FeatureShell` et les dashboards Home sont en haut de window sous
 *    `AppShell`, mais **sous le header du stack detail** de `MobileShell` : les
 *    décorer inconditionnellement rendrait le milieu de l'écran déplaçable sur
 *    fenêtre étroite. Ces headers-là passent par {@link useAtWindowTop}, que le
 *    shell renseigne — c'est lui qui connaît son propre agencement.
 *
 * En mode navigateur web pur, le composant ne rend RIEN.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { isTauri } from '@/lib/tauri';
import { NX } from '@/lib/tokens';

const BUTTON_W = 46;
const BUTTON_H = 32;
const CONTROLS_WIDTH = BUTTON_W * 3; // 138px

/**
 * Hauteur de la bande supérieure réservée aux contrôles fenêtre Tauri.
 *
 * Polish post-ADR-027 : les webviews Tauri (Chromium guests) sont rendues
 * par-dessus TOUT le HTML React (z-index ignoré). Pour que les boutons
 * min/max/close restent visibles et cliquables même quand une webview
 * provider couvre la zone main, on réserve cette bande de 32px en haut
 * (sans webview Tauri dedans). `WebviewProviderPane.computeBounds`
 * importe cette constante pour offsetter la webview.
 */
export const TITLEBAR_HEIGHT = BUTTON_H;

/**
 * Dégage la bande des boutons fenêtre pour une mesure verticale — `top` d'un
 * flottant ancré en haut, ou `padding-top` d'un header collé au haut de la
 * window.
 *
 * Le cluster des boutons fenêtre occupe les {@link CONTROLS_WIDTH} pixels de
 * droite sur {@link TITLEBAR_HEIGHT} de haut, avec un `zIndex` de 200. C'est
 * le seul calque flottant restant, et il doit le rester (il passe au-dessus
 * des webviews provider, qui ignorent le `z-index`). Conséquence : tout
 * contrôle posé dans ce rectangle reçoit les clics de réduire/agrandir/fermer
 * à sa place — le drag region ne protège pas de ça, seul un dégagement le
 * fait.
 *
 * Hors Tauri il n'y a pas de cluster : `base` est rendu tel quel, le design
 * web n'est pas touché.
 *
 * @param base Mesure voulue par le design, en pixels.
 * @param gap Respiration ajoutée sous la bande. 0 (défaut) colle au ras.
 * @returns La mesure effective à poser.
 */
export function topBandOffset(base: number, gap = 0): number {
  if (!isTauri()) return base;
  return Math.max(base, TITLEBAR_HEIGHT + gap);
}

/**
 * Le sous-arbre courant est-il rendu au ras du haut de la window ?
 *
 * Un header ne peut pas le savoir seul : `FeatureShell` et les dashboards Home
 * sont les premiers éléments de la zone main sous `AppShell` (donc en haut de
 * window), mais sont rendus **sous le header du stack detail** sous
 * `MobileShell`. Seul le shell connaît son agencement — d'où ce contexte,
 * renseigné par le shell et lu par les headers.
 *
 * Défaut `false` : un header non enveloppé n'est jamais décoré. On préfère
 * perdre une zone de drag que rendre déplaçable le milieu de l'écran.
 */
const AtWindowTopContext = createContext(false);

/**
 * Déclare que le sous-arbre est (ou non) rendu au ras du haut de la window.
 * À poser par les shells, pas par les écrans.
 */
export function AtWindowTopProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <AtWindowTopContext.Provider value={value}>{children}</AtWindowTopContext.Provider>;
}

/**
 * À lire dans un conteneur de header pour décider s'il porte la drag region et
 * s'il doit dégager la bande du cluster fenêtre (cf. {@link topBandOffset}).
 */
export function useAtWindowTop(): boolean {
  return useContext(AtWindowTopContext);
}

export function TitleBar() {
  if (!isTauri()) return null;
  return <TitleBarInner />;
}

function TitleBarInner() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      // onResized attend un callback void, pas async → on wrap proprement.
      const unlisten = await win.onResized(() => {
        void win.isMaximized().then(setMaximized);
      });
      off = unlisten;
    })().catch((err) => {
      console.warn('[titlebar] Tauri window API indisponible', err);
    });
    return () => {
      try {
        off?.();
      } catch {
        // best effort
      }
    };
  }, []);

  const callWindow = async (action: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      switch (action) {
        case 'minimize':
          await win.minimize();
          break;
        case 'toggleMaximize':
          if (await win.isMaximized()) await win.unmaximize();
          else await win.maximize();
          setMaximized(await win.isMaximized());
          break;
        case 'close':
          await win.close();
          break;
      }
    } catch (err) {
      console.warn('[titlebar] action failed', action, err);
    }
  };

  // Boutons window : flottants top-right, par-dessus tout le contenu. Seul
  // calque restant — cf. JSDoc du module sur la drag region, qui vit
  // désormais sur les conteneurs de header et non ici.
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: BUTTON_H,
        width: CONTROLS_WIDTH,
        display: 'flex',
        zIndex: 200,
      }}
    >
      <WindowButton aria="Réduire" onClick={() => void callWindow('minimize')} icon="minus" />
      <WindowButton
        aria={maximized ? 'Restaurer' : 'Agrandir'}
        onClick={() => void callWindow('toggleMaximize')}
        icon={maximized ? 'restoreSquare' : 'square'}
      />
      <WindowButton aria="Fermer" onClick={() => void callWindow('close')} icon="x" danger />
    </div>
  );
}

function WindowButton({
  aria,
  onClick,
  icon,
  danger,
}: {
  aria: string;
  onClick: () => void;
  icon: 'minus' | 'square' | 'restoreSquare' | 'x';
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const bg = hover ? (danger ? '#E81123' : NX.elevated) : 'transparent';
  const fg = hover && danger ? '#fff' : NX.fgMuted;

  // Style inline plutôt que la classe Tailwind `focus-visible:shadow-focus`
  // (convention du Button partagé, cf. MAN-121) : `boxShadow` est déjà posé
  // en inline ci-dessous pour le relief au hover, et un style inline gagne
  // toujours sur une règle de classe pour la même propriété — la classe
  // Tailwind ne s'appliquerait donc jamais. On réplique `:focus-visible`
  // via `matches()` pour ignorer le focus déclenché par un clic souris.
  const boxShadow = focusVisible ? NX.shadowFocus : hover ? NX.shadowSm : 'none';

  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocusVisible(e.currentTarget.matches(':focus-visible'))}
      onBlur={() => setFocusVisible(false)}
      style={
        {
          width: BUTTON_W,
          height: BUTTON_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: bg,
          color: fg,
          border: 'none',
          cursor: 'pointer',
          // Relief (MAN-111 Task 2) uniquement quand le bouton a une surface
          // opaque pour le porter (hover) — une ombre posée sur le cluster
          // transparent au repos flotterait sans rien en dessous.
          boxShadow,
          transition: 'background 100ms, box-shadow 100ms',
          outline: 'none',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties
      }
    >
      <WindowIcon name={icon} color={fg} />
    </button>
  );
}

/**
 * Mini-icônes inline pour les boutons window (12×12, viewBox 12).
 */
function WindowIcon({
  name,
  color,
}: {
  name: 'minus' | 'square' | 'restoreSquare' | 'x';
  color: string;
}) {
  switch (name) {
    case 'minus':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="2" y1="6" x2="10" y2="6" stroke={color} strokeWidth="1" />
        </svg>
      );
    case 'square':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="2" y="2" width="8" height="8" stroke={color} strokeWidth="1" />
        </svg>
      );
    case 'restoreSquare':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="3.5" y="1.5" width="7" height="7" stroke={color} strokeWidth="1" />
          <rect x="1.5" y="3.5" width="7" height="7" stroke={color} strokeWidth="1" fill={NX.bg} />
        </svg>
      );
    case 'x':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke={color} strokeWidth="1" />
          <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke={color} strokeWidth="1" />
        </svg>
      );
    default:
      return null;
  }
}
