import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Avatar, Logo, PhIcon } from '@/components/ui';
import { NotificationsBell } from './NotificationsBell';
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
import {
  useEventReminderToast,
  reminderTierLabel,
} from '@/lib/useEventReminderToast';
import { useWs } from '@/lib/ws';

import { EventsDashboard } from '../features/EventsDashboard';
import { ExpensesDashboard } from '../features/ExpensesDashboard';
import { PollsDashboard } from '../features/PollsDashboard';
import { TodosDashboard } from '../features/TodosDashboard';

import { ChatView } from './ChatView';
import { GroupMenu } from './GroupMenu';
import { HomeDashboard, type HomeNavTarget } from './HomeDashboard';
import { WebviewProviderPane } from './WebviewProviderPane';

// Pane : la zone main affiche soit la Home Nexus (feed personnel
// trans-groupes, cf. ADR-024), soit le chat du groupe actif, soit l'un des
// 4 dashboards features. Les dashboards utilisent FeatureShell (mode panel).
type Pane = 'home' | 'chat' | 'event' | 'poll' | 'expense' | 'todo';

// ─── Persistance "dernière position" pour la pref `last_*` (cf. ADR-024) ───
// Stockée en localStorage car intrinsèquement device-dependent (le dernier
// canal sur ce desktop ≠ sur mon mobile). En backend on n'a que la pref
// (DB), pas l'état navigationnel.
const LS_LAST_GROUP = 'nx:lastGroup';
const LS_LAST_PANE = 'nx:lastPane';
const LS_LAST_CHANNEL = 'nx:lastChannel';

interface LastLocation {
  groupId: string | null;
  pane: Pane | null;
  channelId: string | null;
}

function readLastLocation(): LastLocation {
  if (typeof window === 'undefined') {
    return { groupId: null, pane: null, channelId: null };
  }
  const rawPane = window.localStorage.getItem(LS_LAST_PANE);
  const validPanes: ReadonlySet<string> = new Set([
    'home',
    'chat',
    'event',
    'poll',
    'expense',
    'todo',
  ]);
  return {
    groupId: window.localStorage.getItem(LS_LAST_GROUP),
    pane: rawPane && validPanes.has(rawPane) ? (rawPane as Pane) : null,
    channelId: window.localStorage.getItem(LS_LAST_CHANNEL),
  };
}

function persistLastLocation(loc: Partial<LastLocation>): void {
  if (typeof window === 'undefined') return;
  if (loc.groupId !== undefined) {
    if (loc.groupId) window.localStorage.setItem(LS_LAST_GROUP, loc.groupId);
    else window.localStorage.removeItem(LS_LAST_GROUP);
  }
  if (loc.pane !== undefined) {
    if (loc.pane) window.localStorage.setItem(LS_LAST_PANE, loc.pane);
    else window.localStorage.removeItem(LS_LAST_PANE);
  }
  if (loc.channelId !== undefined) {
    if (loc.channelId) window.localStorage.setItem(LS_LAST_CHANNEL, loc.channelId);
    else window.localStorage.removeItem(LS_LAST_CHANNEL);
  }
}

/**
 * Résout la destination de landing en fonction de la préférence user et de
 * l'état localStorage (dernière position connue). Fallback silencieux sur
 * 'home' si l'option n'est pas applicable (ex : groupe disparu).
 */
function resolveLandingDestination(
  pref: import('@/lib/auth').LandingPreference,
  knownGroupIds: ReadonlySet<string>,
): { groupId: string | null; pane: Pane } {
  const last = readLastLocation();
  const lastGroupValid = last.groupId && knownGroupIds.has(last.groupId);
  switch (pref) {
    case 'home':
      return { groupId: null, pane: 'home' };
    case 'last_channel':
      if (lastGroupValid) {
        return { groupId: last.groupId, pane: last.pane ?? 'chat' };
      }
      return { groupId: null, pane: 'home' };
    case 'last_group_first_channel':
      if (lastGroupValid) {
        return { groupId: last.groupId, pane: 'chat' };
      }
      return { groupId: null, pane: 'home' };
    case 'last_group_first_feature':
      if (lastGroupValid) {
        return { groupId: last.groupId, pane: 'event' };
      }
      return { groupId: null, pane: 'home' };
    default:
      return { groupId: null, pane: 'home' };
  }
}

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

  // Toast rappel d'event (cf. ADR-020 / J5b #42). Le hook s'abonne au WS,
  // filtre sur l'userId courant, et expose le dernier rappel reçu.
  // Auto-clear après 8 s. Le clic CTA bascule sur le dashboard events du
  // groupe concerné.
  const { toast: reminderToast, dismiss: dismissReminder } = useEventReminderToast(
    user?.id ?? null,
    !initializing && !!user,
  );

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

  // Sessions encapsulées (WhatsApp/Messenger, cf. ADR-022 + ADR-025).
  // Pas de channels (le bridge ne sync rien) — la session entière fait office
  // d'item cliquable. Quand `activeWebviewSessionId` est set, on rend
  // WebviewProviderPane à la place de ChatView (cf. main pane plus bas).
  const webviewSessions = useMemo(
    () => sessions.filter((s) => s.providerType !== 'discord'),
    [sessions],
  );
  const [activeWebviewSessionId, setActiveWebviewSessionId] = useState<string | null>(null);
  const activeWebviewSession =
    webviewSessions.find((s) => s.id === activeWebviewSessionId) ?? null;
  // Si la session active disparaît (delete depuis Settings), on reset
  // proprement pour ne pas afficher un pane orphelin.
  useEffect(() => {
    if (activeWebviewSessionId && !activeWebviewSession) {
      setActiveWebviewSessionId(null);
    }
  }, [activeWebviewSessionId, activeWebviewSession]);

  // Pane initial : 'home' — la résolution de la pref user + last location se
  // fait dans un useEffect une fois les groupes chargés (cf. landingAppliedRef).
  const [pane, setPane] = useState<Pane>('home');
  // Deep-link : quand on clique sur une notif, on note l'id de l'item à ouvrir.
  // Le dashboard concerné consume via prop + clear via callback.
  const [pendingOpen, setPendingOpen] = useState<{ pane: Pane; sourceId: string } | null>(null);

  // ─── Landing preference (cf. ADR-024) ───────────────────────────────────
  // Applique la pref user UNE SEULE FOIS au premier rendu où on a à la fois
  // l'user et la liste des groupes chargée (sinon `last_*` ne peut pas
  // valider que le groupe existe encore). Ref pour ne pas re-tirer à chaque
  // re-render. Reset si on change d'user (logout/relogin).
  const landingAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || groupsQ.isLoading) return;
    if (landingAppliedRef.current === user.id) return;
    const knownIds = new Set(groups.map((g) => g.id));
    const dest = resolveLandingDestination(user.landingPreference, knownIds);
    landingAppliedRef.current = user.id;
    if (dest.groupId) setActiveGroupId(dest.groupId);
    setPane(dest.pane);
  }, [user, groups, groupsQ.isLoading]);

  // ─── Persistance "dernière position" ────────────────────────────────────
  // À chaque change de pane/group/channel, on met à jour le localStorage. La
  // pref `last_*` lit ces clés au prochain login pour rétablir le contexte.
  useEffect(() => {
    persistLastLocation({ groupId: activeGroupId, pane, channelId: activeChannelId });
  }, [activeGroupId, pane, activeChannelId]);

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
        // Killer features : invalidation gérée par `useKillerFeaturesWs`
        // monté au niveau Router (cf. router.tsx → RootComponent).
        default:
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
            boxShadow: NX.glassShadow,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <PhIcon name="check" size={14} color={NX.success} />
          {bridgeToast}
        </div>
      )}
      {reminderToast && (
        <button
          type="button"
          role="status"
          onClick={() => {
            // CTA : bascule sur le dashboard Events du groupe concerné.
            setActiveGroupId(reminderToast.groupId);
            setPane('event');
            dismissReminder();
          }}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 50,
            padding: '10px 16px',
            borderRadius: NX.radius,
            background: NX.glassBg,
            backdropFilter: NX.glassBlur,
            WebkitBackdropFilter: NX.glassBlur,
            color: NX.fg,
            fontSize: 13,
            fontWeight: 600,
            border: `0.5px solid ${NX.glassBorder}`,
            boxShadow: NX.glassShadow,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            maxWidth: 320,
            textAlign: 'left',
          }}
        >
          <PhIcon name="bell" size={16} color={NX.accent} />
          <span style={{ flex: 1 }}>
            Rappel : un événement commence {reminderTierLabel(reminderToast.tier)}.
          </span>
          <PhIcon name="caretRight" size={14} color={NX.fgMuted} />
        </button>
      )}
      <Sidebar
        groups={groups}
        sessionsByGroup={sessionsByGroup}
        activeGroup={activeGroup}
        memberCount={memberCount}
        channels={channels}
        sessions={sessions}
        webviewSessions={webviewSessions}
        activeChannelId={activeChannel?.id ?? null}
        activeWebviewSessionId={activeWebviewSessionId}
        pane={pane}
        userName={user.displayName}
        onSelectGroup={(g) => {
          setActiveGroupId(g.id);
          setPane('chat');
          setActiveChannelId(null);
          setActiveWebviewSessionId(null);
        }}
        onLogoClick={() => {
          setPane('home');
          setPendingOpen(null);
          setActiveWebviewSessionId(null);
        }}
        onSettings={() => void navigate({ to: '/settings' })}
        onChannelSelect={(c) => {
          setActiveChannelId(c.id);
          setActiveWebviewSessionId(null);
          setPane('chat');
        }}
        onWebviewSessionSelect={(s) => {
          setActiveWebviewSessionId(s.id);
          setActiveChannelId(null);
          setPane('chat');
        }}
        // Toggle : cliquer sur un bouton feature actif revient au chat.
        onPaneToggle={(target) => setPane(pane === target ? 'chat' : target)}
        onNotifSelectGroup={(gid) => setActiveGroupId(gid)}
        onNotifSelectPane={(p) => setPane(p)}
        onNotifSetPendingOpen={(p) => setPendingOpen(p)}
      />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {pane === 'home' && (
          <HomeDashboard
            onNavigate={(target: HomeNavTarget) => {
              setActiveGroupId(target.groupId);
              setPane(target.pane);
              if (target.sourceId && target.pane !== 'chat') {
                setPendingOpen({ pane: target.pane, sourceId: target.sourceId });
              } else {
                setPendingOpen(null);
              }
            }}
          />
        )}
        {pane === 'chat' &&
          (activeWebviewSession ? (
            <WebviewProviderPane session={activeWebviewSession} />
          ) : activeGroup && activeChannel && sessionId ? (
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
        {pane === 'event' && activeGroup && (
          <EventsDashboard
            openItemId={pendingOpen?.pane === 'event' ? pendingOpen.sourceId : null}
            onConsumeOpen={() => setPendingOpen(null)}
          />
        )}
        {pane === 'poll' && activeGroup && <PollsDashboard />}
        {pane === 'expense' && activeGroup && (
          <ExpensesDashboard
            openItemId={pendingOpen?.pane === 'expense' ? pendingOpen.sourceId : null}
            onConsumeOpen={() => setPendingOpen(null)}
          />
        )}
        {pane === 'todo' && activeGroup && (
          <TodosDashboard
            openItemId={pendingOpen?.pane === 'todo' ? pendingOpen.sourceId : null}
            onConsumeOpen={() => setPendingOpen(null)}
          />
        )}
      </main>
    </div>
  );
}

function Sidebar({
  groups,
  sessionsByGroup,
  activeGroup,
  memberCount,
  channels,
  sessions,
  webviewSessions,
  activeChannelId,
  activeWebviewSessionId,
  pane,
  userName,
  onLogoClick,
  onSelectGroup,
  onSettings,
  onChannelSelect,
  onWebviewSessionSelect,
  onPaneToggle,
  onNotifSelectGroup,
  onNotifSelectPane,
  onNotifSetPendingOpen,
}: {
  groups: Group[];
  sessionsByGroup: Map<string, MessagingSession[]>;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- ESLint résout `Group` comme `error type` (paths tsconfig non actif côté ESLint, dette J5b backlog)
  activeGroup: Group | null;
  memberCount: number;
  channels: MessagingChannel[];
  sessions: MessagingSession[];
  webviewSessions: MessagingSession[];
  activeChannelId: string | null;
  activeWebviewSessionId: string | null;
  pane: Pane;
  userName: string;
  onLogoClick: () => void;
  onSelectGroup: (g: Group) => void;
  onSettings: () => void;
  onChannelSelect: (c: MessagingChannel) => void;
  onWebviewSessionSelect: (s: MessagingSession) => void;
  onPaneToggle: (p: Pane) => void;
  onNotifSelectGroup: (groupId: string) => void;
  onNotifSelectPane: (p: Pane) => void;
  onNotifSetPendingOpen: (p: { pane: Pane; sourceId: string }) => void;
}) {
  const featureButtons: {
    id: Exclude<Pane, 'chat'>;
    icon: 'calendarBlank' | 'chartBar' | 'currencyDollar' | 'listChecks';
    color: string;
  }[] = useMemo(
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

  const activeGroupId = activeGroup?.id ?? null;

  return (
    <aside
      style={{
        width: 280,
        background: NX.glassBg,
        backdropFilter: NX.glassBlur,
        WebkitBackdropFilter: NX.glassBlur,
        borderRight: `1px solid ${NX.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* === Header brand row : Logo+nom cliquables (→ home) + bell + settings === */}
      <div
        style={{
          padding: '12px 14px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={onLogoClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: pane === 'home' ? NX.primaryMuted : 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            margin: '-4px -8px',
            borderRadius: NX.radiusSm,
            transition: 'background 150ms',
            color: 'inherit',
            flex: 1,
            minWidth: 0,
          }}
          aria-label="Home Nexus"
          title="Home Nexus"
        >
          <Logo size={26} />
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: pane === 'home' ? NX.primaryText : NX.fg,
              flex: 1,
              textAlign: 'left',
            }}
          >
            Nexus
          </span>
        </button>
        <NotificationsBell
          onNavigate={(groupId, kind, sourceId) => {
            if (groupId) onNotifSelectGroup(groupId);
            const targetPane: Pane | null =
              kind === 'event_reminder' || kind === 'event_rsvp_requested' || kind === 'event_rsvp_received'
                ? 'event'
                : kind === 'expense_added'
                  ? 'expense'
                  : kind === 'todo_assigned'
                    ? 'todo'
                    : null;
            if (targetPane) {
              onNotifSelectPane(targetPane);
              if (sourceId) onNotifSetPendingOpen({ pane: targetPane, sourceId });
            }
          }}
        />
        <button
          onClick={onSettings}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: NX.radiusSm,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.7,
          }}
          aria-label="Réglages"
        >
          <PhIcon name="gear" size={18} color={NX.fgMuted} />
        </button>
      </div>

      <div style={{ height: 1, background: NX.border, margin: '0 14px' }} />

      {/* === Groups switcher : pills horizontales scrollables === */}
      <div
        style={{
          padding: '10px 10px 10px',
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
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
          const sessionsForGroup = sessionsByGroup.get(g.id) ?? [];
          const liveSession =
            sessionsForGroup.find((s) => s.status === 'connected') ??
            sessionsForGroup.find((s) => s.status === 'connecting') ??
            sessionsForGroup[0];
          const dotColor = liveSession ? sourceColor[liveSession.providerType] : null;
          return (
            <div
              key={g.id}
              style={{
                position: 'relative',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <button
                onClick={() => onSelectGroup(g)}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: active ? 12 : 19,
                  background: active ? NX.primary : NX.elevated,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'border-radius 0.2s, background 0.2s',
                  fontSize: 12,
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
                    bottom: -1,
                    right: -1,
                    width: 9,
                    height: 9,
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
      </div>

      <div style={{ height: 1, background: NX.border, margin: '0 14px' }} />

      {/* === Active group title === */}
      <div
        style={{
          padding: '12px 14px 8px',
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          flexShrink: 0,
        }}
      >
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
            {activeGroup?.name ?? '—'}
          </div>
          <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>
            {memberCount} membres
          </div>
        </div>
        {activeGroup ? <GroupMenu group={activeGroup} /> : null}
      </div>

      {/* === Feature pickers === */}
      <div style={{ padding: '0 10px 8px', display: 'flex', gap: 4, flexShrink: 0 }}>
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

      {/* === Channels list === */}
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
        {/* Sessions encapsulées WhatsApp/Messenger (cf. ADR-022 + ADR-025) :
            une "session card" par provider, cliquable, qui ouvre le
            WebviewProviderPane dans la zone main. Pas de liste de channels
            (le bridge ne sync rien) — la session entière fait le canal. */}
        {webviewSessions.map((s) => {
          const active = s.id === activeWebviewSessionId && pane === 'chat';
          const accent = sourceColor[s.providerType];
          return (
            <button
              key={s.id}
              onClick={() => onWebviewSessionSelect(s)}
              style={{
                width: 'calc(100% - 12px)',
                margin: '1px 6px',
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: NX.radiusXs,
                background: active ? `${accent}1A` : 'transparent',
                border: 'none',
                color: 'inherit',
                textAlign: 'left',
              }}
              title={s.displayName}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  background: accent,
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {s.providerType === 'whatsapp' ? 'W' : 'M'}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? NX.fg : NX.fgMuted,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.displayName}
              </span>
            </button>
          );
        })}
        {channels.length === 0 && webviewSessions.length === 0 && <ChannelsEmptyState sessions={sessions} />}
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

      {/* === User profile footer === */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: `1px solid ${NX.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
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
