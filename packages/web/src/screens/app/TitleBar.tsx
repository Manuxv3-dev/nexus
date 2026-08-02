/**
 * Window controls + drag region pour nexus desktop (Tauri 2 borderless).
 *
 * Quand `decorations: false` côté tauri.conf.json, on perd la titlebar
 * système. Plutôt que de la remplacer par une barre dédiée (qui fait
 * double-emploi avec les headers du contenu), on intègre directement
 * les boutons fenêtre DANS la window via overlay flottant top-right.
 *
 * En parallèle, on expose une zone de drag invisible en haut de la window
 * (32px de haut, sauf sur la zone des boutons) pour que l'user puisse
 * déplacer la fenêtre en cliquant n'importe où dans le bandeau supérieur.
 *
 * En mode navigateur web pur, le composant ne rend RIEN.
 */
import { useEffect, useState } from 'react';

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

  return (
    <>
      {/* Zone de drag invisible : top de la window, sauf la zone des boutons.
          Permet à l'user de drag la fenêtre depuis n'importe où dans le
          bandeau supérieur (sidebar header, dashboard header, etc.) sans
          conflit avec les contrôles. zIndex moyen pour rester sous les
          dropdowns/notifs. */}
      <div
        data-tauri-drag-region
        aria-hidden
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: CONTROLS_WIDTH,
          height: BUTTON_H,
          zIndex: 90,
          pointerEvents: 'auto',
        }}
      />

      {/* Boutons window : flottants top-right, par-dessus tout le contenu.
          Léger relief (MAN-111 Task 2) pour détacher visuellement le
          cluster de ce qu'il y a en dessous (contenu HTML ou webview
          Tauri) — reste discret, pas de fond/glass qui romprait avec le
          chrome natif de la fenêtre. */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: BUTTON_H,
          display: 'flex',
          zIndex: 200,
          boxShadow: NX.shadowSm,
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
    </>
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
  const bg = hover ? (danger ? '#E81123' : NX.elevated) : 'transparent';
  const fg = hover && danger ? '#fff' : NX.fgMuted;

  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
          transition: 'background 100ms',
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
