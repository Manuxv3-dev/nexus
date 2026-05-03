/**
 * WebviewProviderPane — affichage des sessions encapsulées
 * (WhatsApp Web, Messenger), cf. ADR-022 + ADR-025 + ADR-026.
 *
 * Deux modes runtime :
 *
 *  ┌──────────────────────────┬─────────────────────────────────────────────┐
 *  │ Mode navigateur web pur  │ Mode Nexus Desktop (Tauri)                  │
 *  ├──────────────────────────┼─────────────────────────────────────────────┤
 *  │ Placeholder + bouton     │ Vraie webview native attachée à la window   │
 *  │ "Ouvrir dans un nouvel   │ principale, avec data_directory dédié pour  │
 *  │ onglet" (window.open).   │ persister cookies + session entre runs.     │
 *  │                          │                                             │
 *  │ X-Frame-Options bloque   │ Pas d'iframe → pas de blocage CORS/X-Frame.│
 *  │ tout iframe direct.      │                                             │
 *  └──────────────────────────┴─────────────────────────────────────────────┘
 *
 * En mode Tauri, le composant ne rend qu'un container vide qui sert de
 * "réservation d'espace" — la webview Tauri se superpose AU-DESSUS du HTML.
 * On observe les changements de bounds via ResizeObserver et on synchronise
 * via `setProviderWebviewBounds`. Cleanup au unmount = `destroyProviderWebview`.
 */
import { useEffect, useRef, useState } from 'react';

import { BrandIcon, Button, PhIcon } from '@/components/ui';
import { useDeleteMessagingSession, type MessagingSession } from '@/lib/queries';
import {
  PROVIDER_WEB_URL,
  createProviderWebview,
  destroyProviderWebview,
  isTauri,
  providerWebviewLabel,
  setProviderWebviewBounds,
  type ProviderWebviewBounds,
} from '@/lib/tauri';
import { NX, sourceColor } from '@/lib/tokens';

export interface WebviewProviderPaneProps {
  session: MessagingSession;
  onClose?: () => void;
}

const PROVIDER_META: Record<
  'whatsapp' | 'messenger',
  { name: string; description: string }
> = {
  whatsapp: {
    name: 'WhatsApp Web',
    description:
      "Scanne le QR code depuis l'app WhatsApp de ton téléphone pour te connecter. Tes messages restent côté Meta — Nexus n'enregistre rien.",
  },
  messenger: {
    name: 'Messenger',
    description:
      "Connecte-toi avec ton compte Facebook depuis l'onglet Messenger. Tes messages restent côté Meta — Nexus n'enregistre rien.",
  },
};

export function WebviewProviderPane({ session }: WebviewProviderPaneProps) {
  if (session.providerType === 'discord') {
    // Garde-fou : ce composant ne devrait jamais être monté pour une session
    // Discord. L'AppShell route `discord` vers `<ChatView />`.
    return null;
  }

  const provider = session.providerType;
  if (isTauri()) {
    return <TauriWebviewMount session={session} provider={provider} />;
  }
  return <WebPlaceholder session={session} provider={provider} />;
}

// ─────────────── Mode Tauri : vraie webview native ─────────────────────────

function TauriWebviewMount({
  session,
  provider,
}: {
  session: MessagingSession;
  provider: 'whatsapp' | 'messenger';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const label = providerWebviewLabel(provider, session.id);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    const computeBounds = (): ProviderWebviewBounds => {
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
    };

    // Création au mount.
    void createProviderWebview({
      label,
      url: PROVIDER_WEB_URL[provider],
      bounds: computeBounds(),
    }).catch((err) => {
      console.error('[tauri-webview] create failed', err);
    });

    // Resync bounds quand le container change de taille / position
    // (resize fenêtre, sidebar collapse, etc.).
    const resyncBounds = () => {
      if (cancelled) return;
      void setProviderWebviewBounds({ label, bounds: computeBounds() }).catch((err) => {
        console.error('[tauri-webview] set bounds failed', err);
      });
    };

    const ro = new ResizeObserver(resyncBounds);
    ro.observe(el);
    window.addEventListener('resize', resyncBounds);
    // Scroll global change la position absolue de l'élément → resync.
    window.addEventListener('scroll', resyncBounds, true);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener('resize', resyncBounds);
      window.removeEventListener('scroll', resyncBounds, true);
      // Destroy au unmount. Les cookies restent persistés dans le
      // data_directory (cf. webview.rs) → la session WA reste valide pour
      // la prochaine ouverture, juste la page sera re-load.
      void destroyProviderWebview(label).catch((err) => {
        console.error('[tauri-webview] destroy failed', err);
      });
    };
  }, [label, provider]);

  // Le container vide sert de "réservation d'espace" — la vraie webview
  // Tauri se superpose au-dessus. On affiche un fallback discret si la
  // webview n'a pas encore montée (visible un bref instant au mount).
  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        background: NX.bg,
        position: 'relative',
      }}
      data-tauri-webview-mount={label}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: NX.fgGhost,
          fontSize: 12,
          pointerEvents: 'none',
        }}
      >
        Chargement…
      </div>
    </div>
  );
}

// ─────────────── Mode web pur : placeholder + window.open ──────────────────

function WebPlaceholder({
  session,
  provider,
}: {
  session: MessagingSession;
  provider: 'whatsapp' | 'messenger';
}) {
  const [busy, setBusy] = useState(false);
  const deleteSessionMut = useDeleteMessagingSession();

  const meta = PROVIDER_META[provider];
  const accent = sourceColor[provider];

  const openInNewTab = () => {
    setBusy(true);
    try {
      window.open(PROVIDER_WEB_URL[provider], '_blank', 'noopener,noreferrer');
    } finally {
      window.setTimeout(() => setBusy(false), 600);
    }
  };

  const disconnect = () => {
    if (!window.confirm(`Déconnecter ${meta.name} de ce groupe ?`)) return;
    void deleteSessionMut.mutateAsync({
      groupId: session.groupId,
      sessionId: session.id,
    });
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 20,
        background: NX.bg,
        color: NX.fg,
        textAlign: 'center',
      }}
    >
      {/* Hero logo officiel avec halo coloré */}
      <div
        aria-hidden
        style={{
          width: 96,
          height: 96,
          borderRadius: 24,
          background: `${accent}1F`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 12px 40px ${accent}33`,
        }}
      >
        <BrandIcon brand={provider} size={56} />
      </div>

      <h1
        style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: NX.fg,
          margin: 0,
        }}
      >
        {meta.name}
      </h1>

      <p
        style={{
          maxWidth: 480,
          fontSize: 14,
          color: NX.fgMuted,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {meta.description}
      </p>

      <div
        style={{
          maxWidth: 520,
          padding: '14px 18px',
          background: NX.surface,
          border: `0.5px solid ${NX.border}`,
          borderRadius: NX.radiusMd,
          fontSize: 12,
          color: NX.fgDim,
          lineHeight: 1.55,
          textAlign: 'left',
          display: 'flex',
          gap: 10,
        }}
      >
        <PhIcon name="sparkle" size={14} color={NX.accent} />
        <span>
          <strong style={{ color: NX.fg }}>Pourquoi un nouvel onglet&nbsp;?</strong>{' '}
          {meta.name} bloque l'affichage en iframe pour des raisons de sécurité.
          Dans Nexus desktop (Tauri), une vraie webview native encapsule la
          page directement dans cette zone, sans changer d'onglet.
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button onClick={openInNewTab} variant="primary" size="md" loading={busy}>
          <PhIcon name="link" size={14} />
          <span style={{ marginLeft: 8 }}>Ouvrir {meta.name}</span>
        </Button>
        <Button
          onClick={disconnect}
          variant="ghost"
          size="md"
          loading={deleteSessionMut.isPending}
        >
          Déconnecter de ce groupe
        </Button>
      </div>
    </div>
  );
}
