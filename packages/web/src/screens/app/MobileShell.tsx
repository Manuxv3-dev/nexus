/**
 * Variante mobile de l'AppShell — navigation par stack au lieu du 3-pane.
 *
 * Trois écrans empilés :
 *  1. Liste des groupes
 *  2. Liste des channels (+ killer features tabs)
 *  3. Conversation ou panel feature
 *
 * Conformément à ADR-014, on reste en React web (pas RN). Le stack est
 * géré localement par `screen` ; un swipe-back gesture pourra venir en J4c.
 */
import { useEffect, useState } from 'react';

import { Avatar, Logo, PhIcon, type PhIconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useChannels,
  useGroupMembers,
  useGroups,
  useMessagingSessions,
  type Group,
  type MessagingChannel,
  type MessagingSession,
} from '@/lib/queries';
import { NX, sourceColor, type ProviderType } from '@/lib/tokens';
import { useWs } from '@/lib/ws';

import { ChatView } from './ChatView';
import { EventDetail } from './killer-features/EventDetail';
import { ExpenseDetail } from './killer-features/ExpenseDetail';
import { PollDetail } from './killer-features/PollDetail';
import { TodoDetail } from './killer-features/TodoDetail';

type Pane = 'chat' | 'event' | 'poll' | 'expense' | 'todo';
type Stack = 'groups' | 'channels' | 'detail';

export function MobileShell() {
  const { user, initializing } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];

  const [stack, setStack] = useState<Stack>('groups');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('chat');

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  const sessionsQ = useMessagingSessions(activeGroup?.id);
  const sessions = sessionsQ.data ?? [];
  const sessionId = sessions[0]?.id;
  const channelsQ = useChannels(activeGroup?.id, sessionId);
  const channels = channelsQ.data ?? [];
  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null;
  const providerType: ProviderType =
    sessions.find((s) => s.id === sessionId)?.providerType ?? 'discord';
  const membersQ = useGroupMembers(activeGroup?.id);
  const memberCount = membersQ.data?.length ?? 0;

  useWs({ enabled: !initializing && !!user, onEvent: () => undefined });

  useEffect(() => {
    if (!activeGroupId && groups[0]) {
      setActiveGroupId(groups[0].id);
    }
  }, [groups, activeGroupId]);

  if (initializing) {
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
        <span style={{ color: NX.primary, animation: 'spinSlow 1s linear infinite' }}>⟳</span>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100vh',
        background: NX.bg,
        color: NX.fg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {stack === 'groups' && (
        <GroupsList
          groups={groups}
          activeGroupId={activeGroupId}
          userName={user?.displayName ?? '?'}
          onSelect={(g) => {
            setActiveGroupId(g.id);
            setActiveChannelId(null);
            setStack('channels');
          }}
        />
      )}
      {stack === 'channels' && activeGroup && (
        <ChannelsListMobile
          group={activeGroup}
          memberCount={memberCount}
          channels={channels}
          sessions={sessions}
          onBack={() => setStack('groups')}
          onChannelSelect={(c) => {
            setActiveChannelId(c.id);
            setPane('chat');
            setStack('detail');
          }}
          onPickFeature={(p) => {
            setPane(p);
            setStack('detail');
          }}
        />
      )}
      {stack === 'detail' && activeGroup && (
        <DetailScreen
          onBack={() => setStack('channels')}
          pane={pane}
          activeGroup={activeGroup}
          memberCount={memberCount}
          activeChannel={activeChannel}
          sessionId={sessionId}
          providerType={providerType}
          onPickFeature={(p) => setPane(p)}
        />
      )}
    </div>
  );
}

function GroupsList({
  groups,
  activeGroupId,
  userName,
  onSelect,
}: {
  groups: Group[];
  activeGroupId: string | null;
  userName: string;
  onSelect: (g: Group) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '16px 16px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={28} />
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.04em' }}>nexus</span>
        </div>
        <button
          type="button"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: NX.elevated,
            border: 'none',
            cursor: 'pointer',
          }}
          aria-label="Réglages"
        >
          <PhIcon name="gear" size={18} color={NX.fgMuted} />
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: NX.fgGhost,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            padding: '12px 4px 8px',
          }}
        >
          Tes groupes
        </div>
        {groups.map((g) => {
          const rawInitials = g.name
            .split(/\s+/)
            .map((w) => w.charAt(0))
            .filter(Boolean)
            .slice(0, 2)
            .join('')
            .toUpperCase();
          const initials = rawInitials === '' ? '·' : rawInitials;
          const active = g.id === activeGroupId;
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 10px',
                cursor: 'pointer',
                borderRadius: NX.radiusSm,
                background: active ? NX.primaryMuted : 'transparent',
                marginBottom: 2,
                border: 'none',
                color: 'inherit',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  background: active ? NX.primary : NX.elevated,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 15,
                  fontWeight: 700,
                  color: active ? '#fff' : NX.fgMuted,
                }}
              >
                {initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: NX.fg }}>{g.name}</div>
                <div style={{ fontSize: 12, color: NX.fgDim }}>
                  {/* Le memberCount n'est pas dans le DTO Group : on l'omet
                      ici (chargement supplémentaire par groupe trop coûteux
                      pour la liste). À enrichir en J4b-bis avec un endpoint
                      `GET /groups?withMemberCount=true`. */}
                  Groupe
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: '12px 16px',
          borderTop: `1px solid ${NX.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Avatar name={userName} size={34} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: NX.fg }}>{userName}</div>
          <div style={{ fontSize: 11, color: NX.fgDim }}>En ligne</div>
        </div>
      </div>
    </div>
  );
}

function ChannelsListMobile({
  group,
  memberCount,
  channels,
  sessions,
  onBack,
  onChannelSelect,
  onPickFeature,
}: {
  group: Group;
  memberCount: number;
  channels: MessagingChannel[];
  sessions: MessagingSession[];
  onBack: () => void;
  onChannelSelect: (c: MessagingChannel) => void;
  onPickFeature: (p: 'event' | 'poll' | 'expense' | 'todo') => void;
}) {
  const features: { id: 'event' | 'poll' | 'expense' | 'todo'; icon: PhIconName; color: string; label: string }[] = [
    { id: 'event', icon: 'calendarBlank', color: NX.primaryText, label: 'Événements' },
    { id: 'poll', icon: 'chartBar', color: NX.info, label: 'Sondages' },
    { id: 'expense', icon: 'currencyDollar', color: NX.warning, label: 'Dépenses' },
    { id: 'todo', icon: 'listChecks', color: NX.accent, label: 'Listes' },
  ];

  const providerByChannel = new Map<string, ProviderType>();
  for (const c of channels) {
    const s = sessions.find((s) => s.id === c.sessionId);
    if (s) providerByChannel.set(c.id, s.providerType);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '14px 12px',
          borderBottom: `1px solid ${NX.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
          aria-label="Retour"
        >
          <PhIcon name="caretLeft" size={20} color={NX.fgMuted} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: NX.fg, letterSpacing: '-0.02em' }}>
            {group.name}
          </div>
          <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>
            {memberCount} membres
          </div>
        </div>
      </header>

      <div style={{ padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {features.map((f) => (
          <button
            key={f.id}
            onClick={() => onPickFeature(f.id)}
            style={{
              padding: '14px',
              borderRadius: NX.radiusSm,
              background: NX.elevated,
              border: `1px solid ${NX.border}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'inherit',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `${f.color}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PhIcon name={f.icon} size={18} color={f.color} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: NX.fg }}>{f.label}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        <div
          style={{
            padding: '8px 16px',
            fontSize: 10,
            fontWeight: 600,
            color: NX.fgGhost,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Conversations
        </div>
        {channels.map((c) => {
          const provider = providerByChannel.get(c.id) ?? 'discord';
          return (
            <button
              key={c.id}
              onClick={() => onChannelSelect(c)}
              style={{
                width: '100%',
                padding: '12px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: sourceColor[provider],
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 14, color: NX.fg, flex: 1 }}>{c.name}</span>
              <PhIcon name="caretRight" size={14} color={NX.fgGhost} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetailScreen({
  onBack,
  pane,
  activeGroup,
  memberCount,
  activeChannel,
  sessionId,
  providerType,
  onPickFeature,
}: {
  onBack: () => void;
  pane: Pane;
  activeGroup: Group;
  memberCount: number;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- ESLint résout `MessagingChannel` comme `error type` (paths tsconfig non actif côté ESLint, dette J5b backlog)
  activeChannel: MessagingChannel | null;
  sessionId: string | undefined;
  providerType: ProviderType;
  onPickFeature: (p: Pane) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '12px 12px',
          borderBottom: `1px solid ${NX.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
          aria-label="Retour"
        >
          <PhIcon name="caretLeft" size={20} color={NX.fgMuted} />
        </button>
        <div style={{ fontSize: 14, fontWeight: 600, color: NX.fg }}>
          {pane === 'chat' && activeChannel ? activeChannel.name : title(pane)}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        {pane === 'chat' && activeChannel && sessionId ? (
          <ChatView
            groupId={activeGroup.id}
            sessionId={sessionId}
            channel={activeChannel}
            memberCount={memberCount}
            providerType={providerType}
            onPickFeature={(p) => onPickFeature(p)}
          />
        ) : pane === 'event' ? (
          <EventDetail groupId={activeGroup.id} />
        ) : pane === 'poll' ? (
          <PollDetail groupId={activeGroup.id} />
        ) : pane === 'expense' ? (
          <ExpenseDetail groupId={activeGroup.id} />
        ) : pane === 'todo' ? (
          <TodoDetail groupId={activeGroup.id} />
        ) : null}
      </div>
    </div>
  );
}

function title(pane: Pane): string {
  return pane === 'event'
    ? 'Événements'
    : pane === 'poll'
      ? 'Sondages'
      : pane === 'expense'
        ? 'Dépenses'
        : pane === 'todo'
          ? 'Listes'
          : 'Conversation';
}
