/**
 * WebviewProviderPane — affichage des sessions encapsulées
 * (WhatsApp Web, Messenger), cf. ADR-022 + ADR-025.
 *
 * Phase A (cette version, mode navigateur web) : on NE PEUT PAS rendre la
 * page WhatsApp/Messenger directement (X-Frame-Options: SAMEORIGIN bloque
 * tout iframe). On affiche un placeholder explicatif + un bouton qui ouvre
 * le provider dans un nouvel onglet via `window.open`.
 *
 * Phase B (Tauri desktop, à venir) : ce même composant détectera le runtime
 * Tauri (`window.__TAURI__`) et rendra une vraie WebView native qui
 * encapsule la page. Les cookies de session seront persistés dans un
 * partition cookie store dédié au profil utilisateur Nexus.
 *
 * L'état "session" côté backend reste minimal : juste une déclaration
 * "j'utilise ce provider depuis Nexus" (pas de credentials, pas de bridge
 * worker — cf. ADR-025).
 */
import { useState } from 'react';

import { Button, PhIcon } from '@/components/ui';
import { useDeleteMessagingSession, type MessagingSession } from '@/lib/queries';
import { NX, sourceColor } from '@/lib/tokens';

export interface WebviewProviderPaneProps {
  session: MessagingSession;
  onClose?: () => void;
}

const PROVIDER_META: Record<
  'whatsapp' | 'messenger',
  { name: string; webUrl: string; description: string }
> = {
  whatsapp: {
    name: 'WhatsApp Web',
    webUrl: 'https://web.whatsapp.com',
    description:
      "Scanne le QR code depuis l'app WhatsApp de ton téléphone pour te connecter. Tes messages restent côté Meta — Nexus n'enregistre rien.",
  },
  messenger: {
    name: 'Messenger',
    webUrl: 'https://www.messenger.com',
    description:
      "Connecte-toi avec ton compte Facebook depuis l'onglet Messenger. Tes messages restent côté Meta — Nexus n'enregistre rien.",
  },
};

export function WebviewProviderPane({ session }: WebviewProviderPaneProps) {
  const [busy, setBusy] = useState(false);
  const deleteSessionMut = useDeleteMessagingSession();

  if (session.providerType === 'discord') {
    // Garde-fou : ce composant ne devrait jamais être monté pour une session
    // Discord. L'AppShell route `discord` vers `<ChatView />`.
    return null;
  }

  const meta = PROVIDER_META[session.providerType];
  const accent = sourceColor[session.providerType];

  const openInNewTab = () => {
    setBusy(true);
    try {
      window.open(meta.webUrl, '_blank', 'noopener,noreferrer');
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
      {/* Hero icon avec halo coloré */}
      <div
        aria-hidden
        style={{
          width: 96,
          height: 96,
          borderRadius: 24,
          background: `${accent}1F`,
          color: accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 44,
          fontWeight: 800,
          letterSpacing: '-0.05em',
          boxShadow: `0 12px 40px ${accent}33`,
        }}
      >
        {session.providerType === 'whatsapp' ? 'W' : 'M'}
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
          Dans Nexus desktop (à venir), une vraie webview native encapsulera la
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
