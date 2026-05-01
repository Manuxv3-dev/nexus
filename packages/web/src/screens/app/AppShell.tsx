import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { Avatar, Logo, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useChannels,
  useGroupMembers,
  useGroups,
  useMessagingSessions,
  useMessagingSessionsByGroup,
  type Group,
  type MessagingChannel,
  type MessagingSession,
} from '@/lib/queries';
import { NX, sourceColor } from '@/lib/tokens';
import { useWs } from '@/lib/ws';

import { EventsDashboard } from '../features/EventsDashboard';
import { ExpensesDashboard } from '../features/ExpensesDashboard';
import { PollsDashboard } from '../features/PollsDashboard';
import { TodosDashboard } from '../features/TodosDashboard';

import { ChatView } from './ChatView';
import { GroupMenu } from './GroupMenu';

// Pane : la zone main du 3-pane affiche soit le chat, soit un des 4
// dashboards features. Les dashboards utilisent FeatureShell (mode panel).
type Pane = 'chat' | 'event' | 'poll' | 'expense' | 'todo';

export function AppShell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, initializing } = useAuth();
  useEffect(() => {
    if (!initializing && !user) void navigate({ to: '/login' });
  }, [initializing, user, navigate]);

  // Toast de confirmation déclenché par un postMessage cross-tab depuis la
  // popup OAuth (Settings → /oauth/callback). On écoute aussi ce signal ici
  // pour rafraîchir les sessions même si le user est dans /app au moment où
  // il connecte un bridge depuis Settings.
  const [bridgeToast, setBridgeToast] = useState<string | null>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; provider?: string; groupId?: string };
      if (data?.type !== 'nexus:bridge-connected') return;
      const provider = data.provider ?? 'bridge';
      setBridgeToast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} connecté avec succès.`);
      if (data.groupId) {
        void qc.invalidateQueries({ queryKey: ['messaging-sessions', data.groupId] });
        void qc.invalidateQueries({ queryKey: ['channels', data.groupId] });
      }
      window.setTimeout(() => setBridgeToast(null), 5000);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [qc]);

  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  // Pour le rail : récupère les sessions de chaque groupe pour pouvoir
  // afficher une pastille sur les groupes ayant une messagerie branchée.
  const sessionsByGroup = useMessagingSessionsByGroup(groupIds);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0] ?? null;

  useEffect(() => {
    if (!activeGroupId && groups[0]) setActiveGroupId(groups[0].id);
  }, [groups, activeGroupId]);

  const sessionsQ = useMessagingSessions(activeGroup?.id);
  const sessions = sessionsQ.data ?? [];
  // Pour le MVP, on agrège tous les channels de toutes les sessions du groupe.
  const sessionId = sessions[0]?.id;
  const channelsQ = useChannels(activeGroup?.id, sessionId);
  const channels = channelsQ.data ?? [];
  // Le DTO `group` ne porte pas memberCount (cf. backend GroupDtoSchema) ;
  // on le dérive de la liste des membres réelle.
  const membersQ = useGroupMembers(activeGroup?.id);
  const memberCount = membersQ.data?.length ?? 0;

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? channels[0] ?? null;
  useEffect(() => {
    if (!activeChannelId && channels[0]) setActiveChannelId(channels[0].id);
  }, [channels, activeChannelId]);

  const [pane, setPane] = useState<Pane>('chat');

  // WebSocket pour les events bridges (J3c) — invalide les caches concernés
  // selon l'event reçu, ce qui déclenche un refetch automatique côté
  // composants montés. La mise à jour optimiste (sans refetch) viendra en
  // J4b-bis (mutations side-effect dans queries.ts).
  useWs({
    enabled: !initializing && !!user,
    onEvent: (event) => {
      switch (event.type) {
        case 'message:new':
        case 'message:edit':
        case 'message:delete':
          // Refetch les messages du channel concerné (la query est indexée
          // par groupId + sessionId + channelExternalId).
          void qc.invalidateQueries({
            queryKey: [
              'messages',
              event.groupId,
              event.sessionId,
              event.channelExternalId,
            ],
          });
          break;
        case 'history:synced':
          void qc.invalidateQueries({
            queryKey: [
              'messages',
              event.groupId,
              event.sessionId,
              event.channelExternalId,
            ],
          });
          break;
        case 'message:reaction':
          void qc.invalidateQueries({
            queryKey: [
              'messages',
              event.groupId,
              event.sessionId,
              event.channelExternalId,
            ],
          });
          break;
        case 'presence:update':
          // Pas d'invalidation pour l'instant — la liste des membres n'a
          // pas de champ "presence" exposé côté UI en V1.
          break;
      }
    },
  });

  if (initializing) return <FullScreenLoader />;
  if (!user) return null;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: NX.bg,
        color: NX.fg,
      }}
    >
      {bridgeToast && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            padding: '10px 18px',
            borderRadius: NX.radiusPill,
            background: NX.successBg,
            color: NX.success,
            fontSize: 13,
            fontWeight: 600,
            border: `1px solid rgba(52,211,153,0.25)`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <PhIcon name="check" size={14} color={NX.success} />
          {bridgeToast}
        </div>
      )}
      <GroupsRail
        groups={groups}
        sessionsByGroup={sessionsByGroup}
        activeGroupId={activeGroup?.id ?? null}
        onSelect={(g) => {
          setActiveGroupId(g.id);
          setPane('chat');
          setActiveChannelId(null);
        }}
        onSettings={() => void navigate({ to: '/settings' })}
      />

      <ChannelsPane
        group={activeGroup}
        memberCount={memberCount}
        channels={channels}
        sessions={sessions}
        activeChannelId={activeChannel?.id ?? null}
        pane={pane}
        onChannelSelect={(c) => {
          setActiveChannelId(c.id);
          setPane('chat');
        }}
        // Toggle : cliquer sur un bouton feature actif revient au chat.
        onPaneToggle={(target) => setPane(pane === target ? 'chat' : target)}
        userName={user.displayName}
      />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {pane === 'chat' &&
          (activeGroup && activeChannel && sessionId ? (
            <ChatView
              groupId={activeGroup.id}
              sessionId={sessionId}
              channel={activeChannel}
              memberCount={memberCount}
              providerType={
                sessions.find((s) => s.id === sessionId)?.providerType ?? 'discord'
              }
              onPickFeature={(p) => setPane(p)}
            />
          ) : (
            <EmptyChannel hasGroups={groups.length > 0} hasSessions={sessions.length > 0} />
          ))}
        {pane === 'event' && activeGroup && <EventsDashboard />}
        {pane === 'poll' && activeGroup && <PollsDashboard />}
        {pane === 'expense' && activeGroup && <ExpensesDashboard />}
        {pane === 'todo' && activeGroup && <TodosDashboard />}
      </main>
    </div>
  );
}

function GroupsRail({
  groups,
  sessionsByGroup,
  activeGroupId,
  onSelect,
  onSettings,
}: {
  groups: Group[];
  sessionsByGroup: Map<string, MessagingSession[]>;
  activeGroupId: string | null;
  onSelect: (g: Group) => void;
  onSettings: () => void;
}) {
  return (
    <aside
      style={{
        width: 64,
        background: NX.surface,
        borderRight: `1px solid ${NX.border}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 6,
        flexShrink: 0,
      }}
    >
      <div style={{ marginBottom: 6 }}>
        <Logo size={28} />
      </div>
      <div style={{ width: 32, height: 1, background: NX.border, marginBottom: 2 }} />
      {groups.map((g) => {
        const active = g.id === activeGroupId;
        const rawInitials = g.name
          .split(/\s+/)
          .map((w) => w.charAt(0))
          .filter(Boolean)
          .slice(0, 2)
          .join('')
          .toUpperCase();
        const initials = rawInitials === '' ? '·' : rawInitials;
        // Premier provider connecté du groupe (si plusieurs, on affiche
        // celui dont le statut est "connected" en priorité ; sinon le
        // premier "connecting"/"error").
        const sessions = sessionsByGroup.get(g.id) ?? [];
        const liveSession =
          sessions.find((s) => s.status === 'connected') ??
          sessions.find((s) => s.status === 'connecting') ??
          sessions[0];
        const dotColor = liveSession ? sourceColor[liveSession.providerType] : null;
        return (
          <div
            key={g.id}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <button
              onClick={() => onSelect(g)}
              style={{
                width: 42,
                height: 42,
                borderRadius: active ? 14 : 21,
                background: active ? NX.primary : NX.elevated,
                border: 'none',
                cursor: 'pointer',
                transition: 'border-radius 0.2s',
                fontSize: 13,
                fontWeight: 700,
                color: active ? '#fff' : NX.fgMuted,
              }}
              title={liveSession ? `${g.name} — ${liveSession.providerType}` : g.name}
            >
              {initials}
            </button>
            {dotColor && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 8,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: dotColor,
                  border: `2px solid ${NX.surface}`,
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        );
      })}
      <div style={{ flex: 1 }} />
      <button
        onClick={onSettings}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          opacity: 0.5,
        }}
        aria-label="Réglages"
      >
        <PhIcon name="gear" size={18} color={NX.fgMuted} />
      </button>
    </aside>
  );
}

function ChannelsPane({
  group,
  memberCount,
  channels,
  sessions,
  activeChannelId,
  pane,
  onChannelSelect,
  onPaneToggle,
  userName,
}: {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- ESLint résout `Group` comme `error type` (paths tsconfig non actif côté ESLint, dette J5b backlog)
  group: Group | null;
  memberCount: number;
  channels: MessagingChannel[];
  sessions: MessagingSession[];
  activeChannelId: string | null;
  pane: Pane;
  onChannelSelect: (c: MessagingChannel) => void;
  onPaneToggle: (p: Pane) => void;
  userName: string;
}) {
  const featureButtons: { id: Exclude<Pane, 'chat'>; icon: 'calendarBlank' | 'chartBar' | 'currencyDollar' | 'listChecks'; color: string }[] = useMemo(
    () => [
      { id: 'event', icon: 'calendarBlank', color: NX.primaryText },
      { id: 'poll', icon: 'chartBar', color: NX.info },
      { id: 'expense', icon: 'currencyDollar', color: NX.warning },
      { id: 'todo', icon: 'listChecks', color: NX.accent },
    ],
    [],
  );

  // Mappe channelId → providerType (pour la pastille colorée).
  const providerByChannel = useMemo(() => {
    const m = new Map<string, MessagingSession['providerType']>();
    for (const c of channels) {
      const s = sessions.find((s) => s.id === c.sessionId);
      if (s) m.set(c.id, s.providerType);
    }
    return m;
  }, [channels, sessions]);

  return (
    <aside
      style={{
        width: 224,
        background: NX.surface,
        borderRight: `1px solid ${NX.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <div style={{ padding: '14px 14px 10px', position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: NX.fg,
              letterSpacing: '-0.02em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {group?.name ?? '—'}
          </div>
          <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>
            {memberCount} membres
          </div>
        </div>
        {group ? <GroupMenu group={group} /> : null}
      </div>

      <div style={{ padding: '0 10px 8px', display: 'flex', gap: 4 }}>
        {featureButtons.map((f) => {
          const active = pane === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onPaneToggle(f.id)}
              style={{
                flex: 1,
                height: 34,
                borderRadius: NX.radiusXs,
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: active ? `${f.color}18` : NX.elevated,
                border: `1px solid ${active ? `${f.color}33` : 'transparent'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label={f.id}
            >
              <PhIcon name={f.icon} size={16} color={active ? f.color : NX.fgDim} />
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        <div
          style={{
            padding: '4px 14px',
            fontSize: 10,
            fontWeight: 600,
            color: NX.fgGhost,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Conversations
        </div>
        {channels.length === 0 && (
          <ChannelsEmptyState sessions={sessions} />
        )}
        {channels.map((c) => {
          const provider = providerByChannel.get(c.id) ?? 'discord';
          const active = c.id === activeChannelId && pane === 'chat';
          const dotColor = sourceColor[provider];
          return (
            <button
              key={c.id}
              onClick={() => onChannelSelect(c)}
              style={{
                width: 'calc(100% - 12px)',
                margin: '1px 6px',
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: NX.radiusXs,
                background: active ? NX.primaryMuted : 'transparent',
                border: 'none',
                color: 'inherit',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: dotColor,
                  flexShrink: 0,
                  opacity: 0.7,
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: c.unread ? 600 : 400,
                  color: c.unread ? NX.fg : NX.fgMuted,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.name}
              </span>
              {c.unread && c.unread > 0 ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    background: NX.primary,
                    borderRadius: 8,
                    padding: '1px 5px',
                    minWidth: 16,
                    textAlign: 'center',
                  }}
                >
                  {c.unread}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: '10px 12px',
          borderTop: `1px solid ${NX.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Avatar name={userName} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: NX.fg }}>{userName}</div>
          <div style={{ fontSize: 10, color: NX.fgDim }}>En ligne</div>
        </div>
      </div>
    </aside>
  );
}

/**
 * Etat vide du pane channels — distingue clairement les cas pour le user :
 *   - aucune session sur ce groupe : il faut connecter Discord
 *   - session en connexion : le worker est en train d'attacher
 *   - session connected mais 0 channels : worker rattache mais le serveur
 *     Discord n'a pas de channel texte visible, ou la session est en error
 */
function ChannelsEmptyState({ sessions }: { sessions: MessagingSession[] }) {
  if (sessions.length === 0) {
    return (
      <div style={{ padding: '12px 14px', fontSize: 12, color: NX.fgDim, lineHeight: 1.5 }}>
        Aucune messagerie connectee sur ce groupe.
        <br />
        Ajoute Discord depuis les Reglages.
      </div>
    );
  }

  const connecting = sessions.find((s) => s.status === 'connecting');
  const error = sessions.find((s) => s.status === 'error');

  if (connecting) {
    return (
      <div style={{ padding: '12px 14px', fontSize: 12, color: NX.fgDim, lineHeight: 1.5 }}>
        Connexion {connecting.providerType} en cours...
        <br />
        Verifie que le worker tourne :
        <code
          style={{
            display: 'inline-block',
            padding: '1px 6px',
            marginTop: 4,
            background: NX.raised,
            borderRadius: 4,
            fontSize: 11,
            color: NX.fg,
          }}
        >
          pnpm --filter @nexus/backend dev:worker:discord
        </code>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '12px 14px', fontSize: 12, color: NX.error, lineHeight: 1.5 }}>
        Bridge {error.providerType} en erreur.
        {error.lastError && (
          <div style={{ marginTop: 4, color: NX.fgDim, fontSize: 11 }}>{error.lastError}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px', fontSize: 12, color: NX.fgDim, lineHeight: 1.5 }}>
      Aucun channel texte trouve sur la messagerie.
      <br />
      Verifie les permissions du bot Nexus sur ton serveur Discord.
    </div>
  );
}

function EmptyChannel({ hasGroups, hasSessions }: { hasGroups: boolean; hasSessions: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: NX.fgDim,
        textAlign: 'center',
        padding: 32,
      }}
    >
      <Logo size={56} />
      {!hasGroups ? (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, color: NX.fg }}>Aucun groupe</div>
          <div style={{ fontSize: 13, maxWidth: 320, lineHeight: 1.6 }}>
            Cree ou rejoins un groupe pour commencer.
          </div>
        </>
      ) : !hasSessions ? (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, color: NX.fg }}>Pas encore de messagerie connectee</div>
          <div style={{ fontSize: 13, maxWidth: 320, lineHeight: 1.6 }}>
            Branche Discord, WhatsApp ou Messenger depuis les Reglages.
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, color: NX.fg }}>Selectionne une conversation</div>
        </>
      )}
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: NX.bg,
      }}
    >
      <span style={{ animation: 'spinSlow 1s linear infinite', fontSize: 24, color: NX.primary }}>
        ⟳
      </span>
    </div>
  );
}
