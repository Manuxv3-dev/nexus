import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Avatar, PhIcon, type PhIconName } from '@/components/ui';
import { NX } from '@/lib/tokens';

export function FeatureHeader({
  icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  action,
}: {
  icon: PhIconName;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${NX.border}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: iconBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhIcon name={icon} size={22} color={iconColor} />
          </div>
          <div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: NX.fg,
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <div style={{ fontSize: 12, color: NX.fgDim, marginTop: 3 }}>{subtitle}</div>
            )}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}

/**
 * Hook réutilisable pour la logique "Copier le lien" + feedback visuel.
 * Retourne :
 *  - `copy` : handler à attacher à un onClick
 *  - `state` : 'idle' | 'copied' | 'error'
 *  - `label` : libellé adapté au state ('Copier le lien' / 'Copié !' / 'Échec')
 *  - `iconName` : nom d'icône Phosphor adapté ('link' ou 'checkSquare')
 *
 * Reset auto à 'idle' après 2s. Utilisé par CopyLinkButton (page publique
 * de partage) et par les boutons inline des 4 modals (EventModal,
 * PollModal, ExpenseModal, TodoListModal) pour un comportement uniforme.
 */
export function useCopyLink({
  slug,
  kind,
}: {
  slug: string | undefined;
  kind: 'e' | 'p' | 'd' | 't' | 'l';
}): {
  copy: () => void;
  state: 'idle' | 'copied' | 'error';
  label: string;
  iconName: PhIconName;
} {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copy = (): void => {
    if (!slug) return;
    const url = `${window.location.origin}/${kind}/${slug}`;
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
        setState('copied');
      } catch (err) {
        console.warn('[copy] clipboard indispo', err);
        setState('error');
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setState('idle'), 2000);
    })();
  };

  const label = state === 'copied' ? 'Copié !' : state === 'error' ? 'Échec' : 'Copier le lien';
  const iconName: PhIconName = state === 'copied' ? 'checkSquare' : 'link';

  return { copy, state, label, iconName };
}

export function CopyLinkButton({
  slug,
  kind,
}: {
  slug: string;
  kind: 'e' | 'p' | 'd' | 't' | 'l';
}) {
  // Feedback visuel post-copie : 'idle' → 'copied' → (2s plus tard) → 'idle'.
  // En cas d'échec clipboard (HTTPS requis sur certains navigateurs, perms),
  // on affiche un état 'error' en rouge ~2s aussi.
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [hover, setHover] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = async () => {
    const url = `${window.location.origin}/${kind}/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch (err) {
      console.warn('[copy] clipboard indispo', err);
      setState('error');
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setState('idle'), 2000);
  };

  const isCopied = state === 'copied';
  const isError = state === 'error';
  const labelColor = isCopied ? NX.success : isError ? NX.error : hover ? NX.fg : NX.fgMuted;
  const iconName: PhIconName = isCopied ? 'checkSquare' : isError ? 'link' : 'link';
  const label = isCopied ? 'Copié !' : isError ? 'Échec — copie manuelle' : 'Copier le lien';

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? NX.surface : NX.elevated,
        border: `1px solid ${
          isCopied ? NX.success : isError ? NX.error : hover ? NX.borderStrong : NX.border
        }`,
        borderRadius: NX.radiusPill,
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        color: labelColor,
        fontSize: 12,
        fontWeight: isCopied || isError ? 600 : 500,
        transition: 'background 120ms, border-color 120ms, color 120ms',
        // Effet de clic instantané : léger scale-down (compressed) avant
        // que l'état "copied" s'installe.
        transform: 'scale(1)',
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
      onBlur={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <PhIcon name={iconName} size={14} color={labelColor} />
      {label}
    </button>
  );
}

export function PersonRow({
  name,
  size = 26,
  right,
}: {
  name: string;
  size?: number;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <Avatar name={name} size={size} />
      <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>{name}</span>
      {right}
    </div>
  );
}

export function PanelRoot({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      {children}
    </div>
  );
}

export function PanelEmpty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
        color: NX.fgDim,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: NX.fg }}>{title}</div>
        {hint && <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
      </div>
    </div>
  );
}
