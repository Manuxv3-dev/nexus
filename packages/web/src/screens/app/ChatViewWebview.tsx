/**
 * ChatViewWebview — placeholder + CTA pour Messenger / WhatsApp (cf. ADR-022).
 *
 * Branche encapsulation webview : pour les providers où Nexus n'a pas
 * d'accès programmable (Messenger, WhatsApp), on ne render PAS un thread
 * de messages natifs. À la place :
 *  - Un placeholder identitaire (couleur provider + nom du channel)
 *  - Un CTA "Ouvrir [Provider]" qui ouvre l'app web officielle
 *
 * Comportement par plateforme :
 *  - **Tauri desktop** : V1 → ouvre l'URL via `window.open` (qui sur Tauri
 *    ouvre dans le browser système ou crée une child window selon config).
 *    V1.5 → vraie embedded webview Tauri (`<webview>` natif Chromium qui
 *    ignore X-Frame-Options) — tracé en backlog.
 *  - **Web SPA (browser)** : `window.open(url, '_blank')` → nouvel onglet
 *    avec l'app officielle Messenger/WhatsApp. UX dégradée mais
 *    fonctionnelle (option W2 de l'ADR-022).
 *
 * Le user s'authentifie directement dans la webview/onglet (login Facebook
 * pour Messenger, QR code pour WhatsApp Web). Aucun credential n'est
 * persisté côté Nexus.
 */
import { Badge, PhIcon } from '@/components/ui';
import { type MessagingChannel } from '@/lib/queries';
import { NX, sourceColor, sourceBg, type ProviderType } from '@/lib/tokens';

export interface ChatViewWebviewProps {
  channel: MessagingChannel;
  memberCount: number;
  providerType: Extract<ProviderType, 'messenger' | 'whatsapp'>;
}

const PROVIDER_URL: Record<ChatViewWebviewProps['providerType'], string> = {
  messenger: 'https://www.messenger.com',
  whatsapp: 'https://web.whatsapp.com',
};

const PROVIDER_LABEL: Record<ChatViewWebviewProps['providerType'], string> = {
  messenger: 'Messenger',
  whatsapp: 'WhatsApp Web',
};

export function ChatViewWebview({
  channel,
  memberCount,
  providerType,
}: ChatViewWebviewProps) {
  const providerLabel = PROVIDER_LABEL[providerType];
  const providerUrl = PROVIDER_URL[providerType];

  const openProvider = () => {
    // V1 : window.open est compatible web et Tauri (ouvre dans le browser
    // système côté Tauri, ou nouvel onglet côté web). V1.5 : remplacer par
    // la vraie embedded webview Tauri. Cf. backlog J7/J8.
    window.open(providerUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <header
        style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${NX.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: NX.fg }}>{channel.name}</span>
        <Badge tone={providerType}>{providerLabel}</Badge>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: NX.fgDim,
            }}
          >
            <PhIcon name="users" size={16} color={NX.fgDim} />
            {memberCount}
          </span>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          padding: '32px 24px',
          textAlign: 'center',
        }}
      >
        {/* Bulle identitaire colorée — couleur officielle du provider */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: sourceColor[providerType],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 12px 32px ${sourceBg[providerType]}`,
          }}
        >
          <PhIcon name="chatCircle" size={40} color="#FFFFFF" />
        </div>

        <div style={{ maxWidth: 360 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: NX.fg,
              margin: 0,
              marginBottom: 8,
              letterSpacing: '-0.01em',
            }}
          >
            {providerLabel}
          </h2>
          <p
            style={{
              fontSize: 13,
              color: NX.fgMuted,
              margin: 0,
              lineHeight: 1.55,
            }}
          >
            Tes conversations {providerLabel} restent dans l'app officielle.
            Nexus garde la coordination (events, sondages, dépenses, todos)
            partageable via un lien dans n'importe quelle conversation.
          </p>
        </div>

        <button
          type="button"
          onClick={openProvider}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: NX.radiusPill,
            border: 'none',
            cursor: 'pointer',
            background: sourceColor[providerType],
            color: '#FFFFFF',
            fontSize: 13,
            fontWeight: 600,
            boxShadow: NX.shadowSm,
          }}
        >
          Ouvrir {providerLabel}
          <PhIcon name="arrowRight" size={14} color="#FFFFFF" />
        </button>

        <p
          style={{
            fontSize: 11,
            color: NX.fgGhost,
            margin: 0,
            maxWidth: 320,
            lineHeight: 1.5,
          }}
        >
          Ouverture dans une nouvelle fenêtre. Connexion à l'app officielle
          requise (Facebook pour Messenger, QR code pour WhatsApp Web).
        </p>
      </div>
    </>
  );
}
