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
 * via `setProviderWebviewBounds`.
 *
 * Lifecycle webview Tauri (cf. polish P3, ADR-027) :
 *  - Au mount du Pane : `createProviderWebview` (idempotent côté Rust :
 *    crée si absent, sinon set_position aux nouveaux bounds = "show").
 *  - Au unmount : `setProviderWebviewVisible(false)` envoie hors-écran
 *    (-10000, 1×1) sans détruire. Cookies + DOM préservés → retour
 *    instantané sans reload (notamment WhatsApp pas de re-scan QR).
 *  - Cleanup réel (destroy) : `useDeleteMessagingSession` dans queries.ts
 *    quand l'user retire la session depuis Settings.
 */
import { useEffect, useRef, useState } from 'react';

import { BrandIcon, Button, PhIcon } from '@/components/ui';
import { useDeleteMessagingSession, type MessagingSession } from '@/lib/queries';
import {
  PROVIDER_WEB_URL,
  createProviderWebview,
  isTauri,
  providerWebviewLabel,
  setProviderWebviewBounds,
  setProviderWebviewVisible,
  type ProviderWebviewBounds,
  type WebviewProvider,
} from '@/lib/tauri';
import { NX, sourceColor } from '@/lib/tokens';

import { TITLEBAR_HEIGHT } from './TitleBar';

export interface WebviewProviderPaneProps {
  session: MessagingSession;
  onClose?: () => void;
}

/**
 * Méta UI par provider — utilisé par le placeholder web (PROVIDER_META.name
 * et .description) et le hero du Tauri pendant que la webview se charge.
 *
 * Cf. ADR-027 : 12 providers en webview encapsulée.
 */
const PROVIDER_META: Record<
  WebviewProvider,
  { name: string; description: string }
> = {
  discord: {
    name: 'Discord',
    description:
      "Connecte-toi à ton compte Discord. Tes serveurs, DMs et appels vocaux restent côté Discord — nexus n'enregistre rien.",
  },
  whatsapp: {
    name: 'WhatsApp Web',
    description:
      "Scanne le QR code depuis l'app WhatsApp de ton téléphone pour te connecter. Tes messages restent côté Meta — nexus n'enregistre rien.",
  },
  messenger: {
    name: 'Messenger',
    description:
      "Connecte-toi avec ton compte Facebook depuis l'onglet Messenger. Tes messages restent côté Meta — nexus n'enregistre rien.",
  },
  telegram: {
    name: 'Telegram',
    description:
      "Connecte-toi via QR code ou numéro depuis Telegram Web. Tes conversations restent côté Telegram.",
  },
  instagram: {
    name: 'Instagram',
    description:
      "Connecte-toi à Instagram pour accéder à tes DMs. Tes échanges restent côté Meta — nexus n'enregistre rien.",
  },
  slack: {
    name: 'Slack',
    description:
      "Connecte-toi à ton workspace Slack. Multi-workspaces possibles : connecte plusieurs sessions Slack pour switcher.",
  },
  teams: {
    name: 'Microsoft Teams',
    description:
      "Connecte-toi à ton compte Microsoft pour Teams. Chats, channels et appels restent côté Microsoft.",
  },
  linkedin: {
    name: 'LinkedIn',
    description:
      "Accède à tes messages LinkedIn directement dans nexus. Tes échanges restent côté LinkedIn.",
  },
  twitter: {
    name: 'X',
    description:
      "Connecte-toi à X pour accéder à tes DMs. Tes messages restent côté X — nexus n'enregistre rien.",
  },
  reddit: {
    name: 'Reddit',
    description:
      "Accède à Reddit Chat directement dans nexus. Tes conversations restent côté Reddit.",
  },
  tiktok: {
    name: 'TikTok',
    description:
      "Accède à tes messages TikTok. La messagerie web TikTok est limitée — pour la version complète, utilise l'app mobile.",
  },
  snapchat: {
    name: 'Snapchat',
    description:
      "Accède à Snapchat Web. Note : la version web ne supporte pas les Snaps éphémères, juste les chats texte.",
  },
};

export function WebviewProviderPane({ session }: WebviewProviderPaneProps) {
  // Depuis ADR-027 (universalisation webview), Discord est lui aussi un
  // provider webview comme les autres. Plus de guard ici.
  const provider = session.providerType as WebviewProvider;
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
  provider: WebviewProvider;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const label = providerWebviewLabel(provider, session.id);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    const computeBounds = (): ProviderWebviewBounds => {
      const rect = el.getBoundingClientRect();
      // Polish P2 : réserve TITLEBAR_HEIGHT en haut pour que les contrôles
      // window flottants (min/max/close) restent visibles ET cliquables. Les
      // webviews Tauri (Chromium guests) sont rendues par-dessus le HTML
      // React indépendamment du z-index ; sans cet offset, les boutons sont
      // occultés dès qu'une webview provider couvre la zone main.
      const topOffset = Math.max(rect.top, TITLEBAR_HEIGHT);
      return {
        x: rect.left,
        y: topOffset,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.bottom - topOffset),
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
      // Polish P3 : hide au lieu de destroy. Au remount (ex : retour à
      // cette session après un switch), `createProviderWebview` est
      // idempotent côté Rust et fait juste un set_position avec les
      // nouveaux bounds → affichage instantané, pas de reload, pas de
      // re-scan QR code (cas WhatsApp). Cleanup réel délégué à
      // `useDeleteMessagingSession` quand l'user retire la session.
      void setProviderWebviewVisible({ label, visible: false }).catch((err) => {
        console.warn('[tauri-webview] hide failed', err);
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
  provider: WebviewProvider;
}) {
  const [busy, setBusy] = useState(false);
  const deleteSessionMut = useDeleteMessagingSession();

  // `noUncheckedIndexedAccess` rend l'accès indexé Record<K,V>[k] -> V|undefined.
  // Tous les `WebviewProvider` ont une entrée garantie dans `PROVIDER_META`
  // (cf. ADR-027 : 12 providers, type union exhaustif), fallback safe.
  const meta = PROVIDER_META[provider] ?? { name: provider, description: '' };
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
    // M1 (post-ADR-027) : sessions scopées USER, plus de "ce groupe".
    if (!window.confirm(`Déconnecter ${meta.name} de nexus ?`)) return;
    void deleteSessionMut.mutateAsync({
      sessionId: session.id,
      // Polish P3 : permet au hook de cleanup la webview Tauri persistante.
      providerType: provider,
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
