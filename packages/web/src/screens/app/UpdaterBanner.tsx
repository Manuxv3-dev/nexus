/**
 * Banner de mise à jour desktop (cf. ADR-031 — auto-updater Tauri).
 *
 * Affiché en haut-centre de l'AppShell quand le hook `useUpdater` détecte
 * une nouvelle version. États rendus :
 *   - `available`   → "Nexus X.Y.Z est disponible" + Installer / Plus tard
 *   - `downloading` → barre de progression
 *   - `ready`       → "Redémarrage…" (transitoire avant relaunch)
 *   - `error`       → message + Réessayer
 *
 * Invisible en web pur (le hook reste `idle`) et quand l'user a dismiss.
 * Style Liquid Glass aligné sur les autres toasts de l'AppShell.
 */
import { PhIcon } from '@/components/ui';
import { NX } from '@/lib/tokens';
import type { UseUpdaterResult } from '@/lib/useUpdater';

/** Formate un nombre d'octets en libellé court (Ko/Mo). */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 Ko';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export interface UpdaterBannerProps {
  updater: UseUpdaterResult;
}

export function UpdaterBanner({ updater }: UpdaterBannerProps): React.ReactNode {
  const { status, version, progress, error, dismissed } = updater;

  // Rien à montrer : web pur, à jour, ou masqué par l'user.
  if (dismissed) return null;
  if (
    status !== 'available' &&
    status !== 'downloading' &&
    status !== 'ready' &&
    status !== 'error'
  ) {
    return null;
  }
  // On ne montre l'erreur que si elle survient pendant un flux d'install
  // déjà visible — une erreur de check silencieux ne pollue pas l'UI.
  if (status === 'error' && version === null) return null;

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        minWidth: 320,
        maxWidth: 460,
        padding: '12px 16px',
        borderRadius: NX.radiusLg,
        background: NX.glassBgStrong,
        backdropFilter: NX.glassBlur,
        WebkitBackdropFilter: NX.glassBlur,
        color: NX.fg,
        border: `0.5px solid ${NX.glassBorder}`,
        boxShadow: NX.glassShadow,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PhIcon name="sparkle" size={18} color={NX.primary} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {status === 'available' && (
            <span style={{ fontSize: 13, fontWeight: 600 }}>Nexus {version} est disponible</span>
          )}
          {status === 'downloading' && (
            <span style={{ fontSize: 13, fontWeight: 600 }}>Téléchargement de la mise à jour…</span>
          )}
          {status === 'ready' && (
            <span style={{ fontSize: 13, fontWeight: 600 }}>Redémarrage de Nexus…</span>
          )}
          {status === 'error' && (
            <span style={{ fontSize: 13, fontWeight: 600, color: NX.error }}>
              {error ?? 'La mise à jour a échoué.'}
            </span>
          )}
        </div>
        {(status === 'available' || status === 'error') && (
          <button
            type="button"
            aria-label="Masquer"
            onClick={updater.dismiss}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
            }}
          >
            <PhIcon name="x" size={14} color={NX.fgMuted} />
          </button>
        )}
      </div>

      {status === 'downloading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              height: 6,
              borderRadius: NX.radiusPill,
              background: NX.border,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: pct !== null ? `${pct}%` : '40%',
                background: NX.primary,
                borderRadius: NX.radiusPill,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          {progress && (
            <span style={{ fontSize: 11, color: NX.fgMuted }}>
              {pct !== null
                ? `${pct}% — ${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                : formatBytes(progress.downloaded)}
            </span>
          )}
        </div>
      )}

      {status === 'available' && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={updater.dismiss}
            style={{
              padding: '6px 14px',
              borderRadius: NX.radiusPill,
              border: `0.5px solid ${NX.border}`,
              background: 'transparent',
              color: NX.fgMuted,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Plus tard
          </button>
          <button
            type="button"
            onClick={updater.install}
            style={{
              padding: '6px 14px',
              borderRadius: NX.radiusPill,
              border: 'none',
              background: NX.primary,
              color: NX.primaryText,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <PhIcon name="downloadSimple" size={13} color={NX.primaryText} />
            Installer
          </button>
        </div>
      )}

      {status === 'error' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={updater.install}
            style={{
              padding: '6px 14px',
              borderRadius: NX.radiusPill,
              border: `0.5px solid ${NX.border}`,
              background: 'transparent',
              color: NX.fg,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}
