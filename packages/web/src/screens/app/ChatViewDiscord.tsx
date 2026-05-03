/**
 * ChatViewDiscord — rendu natif du chat (cf. ADR-022).
 *
 * Branche Discord : on a un accès programmable via l'API officielle
 * (cf. ADR-006), donc on render :
 *  - Header (channel name + badge provider + actions)
 *  - Liste de messages (DTO API Nexus, persistés via cache `messaging_messages`)
 *  - Composer pour envoyer
 *
 * C'est exactement le code historique de `ChatView.tsx` avant l'introduction
 * du dispatcher multi-mode (refactor #11). Aucun changement comportemental.
 */
import { useEffect, useRef, useState } from 'react';

import { Avatar, Badge, PhIcon } from '@/components/ui';
import { useMessages, useSendMessage, type MessagingChannel } from '@/lib/queries';
import { NX, sourceBg, type ProviderType } from '@/lib/tokens';

export interface ChatViewDiscordProps {
  groupId: string;
  sessionId: string;
  channel: MessagingChannel;
  memberCount: number;
  providerType: ProviderType;
}

export function ChatViewDiscord({
  groupId,
  sessionId,
  channel,
  memberCount,
  providerType,
}: ChatViewDiscordProps) {
  // Le path param `:channelId` côté backend attend l'externalChannelId du
  // provider (snowflake Discord, etc.) — pas l'UUID Nexus.
  const messagesQ = useMessages(groupId, sessionId, channel.externalChannelId);
  const send = useSendMessage(groupId, sessionId, channel.externalChannelId);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll en bas à chaque mise à jour de la liste de messages.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messagesQ.data]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      await send.mutateAsync(text);
    } catch (err) {
      console.error('[chat] envoi échoué', err);
      // En vrai V1 : toast d'erreur + retry. Pour l'instant on remet le texte.
      setDraft(text);
    }
  };

  const messages = messagesQ.data ?? [];

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
        <Badge tone={providerType}>
          {providerType.charAt(0).toUpperCase() + providerType.slice(1)}
        </Badge>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <PhIcon name="pushPin" size={16} color={NX.fgDim} />
          <PhIcon name="magnifyingGlass" size={16} color={NX.fgDim} />
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
        ref={scrollRef}
        style={{
          flex: 1,
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflow: 'auto',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: NX.fgDim,
            textAlign: 'center',
            padding: '4px 0',
          }}
        >
          — {messagesQ.isLoading ? 'Chargement…' : "Aujourd'hui"} —
        </div>

        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', gap: 8 }}>
            <Avatar name={m.authorDisplayName} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: NX.fg }}>
                  {m.authorDisplayName}
                </span>
                <span style={{ fontSize: 10, color: NX.fgGhost }}>
                  {new Date(m.externalCreatedAt).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: NX.fgMuted,
                  marginTop: 1,
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}
              >
                {m.content}
              </div>
            </div>
          </div>
        ))}

        {/* Suggestion IA retirée — feature mise de côté, à reprendre en J6
            (intent detection Claude). Cf. backlog. */}
      </div>

      <form
        onSubmit={(e) => void submit(e)}
        style={{
          padding: '10px 16px',
          borderTop: `1px solid ${NX.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            background: NX.surface,
            borderRadius: NX.radius,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <PhIcon name="plus" size={18} color={NX.fgDim} />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Écrire dans ${channel.name}...`}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 13,
              color: NX.fg,
            }}
          />
          <PhIcon name="smiley" size={18} color={NX.fgDim} />
          <PhIcon name="paperclip" size={18} color={NX.fgDim} />
          {draft && (
            <button
              type="submit"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              aria-label="Envoyer"
            >
              <PhIcon name="paperPlaneRight" size={18} color={NX.primary} />
            </button>
          )}
        </div>
        {/* Le providerType + sessionId restent en contexte pour debug — non visibles. */}
        <span style={{ display: 'none' }} aria-hidden>
          {sourceBg[providerType]}
        </span>
      </form>
    </>
  );
}
