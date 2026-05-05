import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Avatar, BrandIcon, Logo, PhIcon } from '@/components/ui';
import { NotificationsBell } from './NotificationsBell';
import { useAuth } from '@/lib/auth';
import {
  useGroupMembers,
  useGroups,
  useMessagingSessions,
  type Group,
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

import { GroupMenu } from './GroupMenu';
import { GroupHomeDashboard, type GroupHomeNavTarget } from './GroupHomeDashboard';
import { HomeDashboard, type HomeNavTarget } from './HomeDashboard';
import { WebviewProviderPane } from './WebviewProviderPane';

// Pane : la zone main affiche soit la Home nexus (feed personnel
// trans-groupes, cf. ADR-024), soit la home du groupe actif (cf. P7),
// soit le chat du groupe actif, soit l'un des 4 dashboards features.
// Les dashboards utilisent FeatureShell (mode panel).
type Pane = 'home' | 'group_home' | 'chat' | 'event' | 'poll' | 'expense' | 'todo';

// ─── Persistance "dernière position" pour la pref `last_*` (cf. ADR-024) ───
// Stockée en localStorage car intrinsèquement device-dependent (le dernier
// canal sur ce desktop ≠ sur mon mobile). En backend on n'a que la pref
// (DB), pas l'état navigationnel.
const LS_LAST_GROUP = 'nx:lastGroup';
const LS_LAST_PANE = 'nx:lastPane';
const LS_LAST_CHANNEL = 'nx:lastChannel';

// ─── Persistance "ordre des sessions" PER-USER (cf. polish P4 révision) ───
// Chaque user a sa propre vue de l'ordre des sessions messageries dans la
// sidebar. Stocké en localStorage car device-dependent et user-specific
// (rien à mutualiser côté serveur). Les sessions absentes du tableau
// (nouvelles connexions) sont placées à la fin dans l'ordre serveur.
const LS_SESSION_ORDER_PREFIX = 'nx:sessionOrder:';

function readSessionOrder(groupId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_SESSION_ORDER_PREFIX + groupId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeSessionOrder(groupId: string, ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_SESSION_ORDER_PREFIX + groupId, JSON.stringify(ids));
  } catch {
    // localStorage plein ou désactivé → silent (l'ordre revient au défaut au
    // prochain mount, pas critique).
  }
}

function sortSessionsByLocalOrder(
  sessions: MessagingSession[],
  groupId: string | null,
): MessagingSession[] {
  if (!groupId || sessions.length === 0) return sessions;
  const order = readSessionOrder(groupId);
  if (order.length === 0) return sessions;
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const ordered: MessagingSession[] = [];
  // 1. Sessions présentes dans l'ordre stocké, dans l'ordre.
  for (const id of order) {
    const s = byId.get(id);
    if (s) {
      ordered.push(s);
      byId.delete(id);
    }
  }
  // 2. Sessions nouvelles (absentes du localStorage) → à la fin dans
  //    l'ordre serveur d'origine.
  for (const s of sessions) {
    if (byId.has(s.id)) ordered.push(s);
  }
  return ordered;
}

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
    'group_home',
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
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0] ?? null;

  useEffect(() => {
    if (!activeGroupId && groups[0]) setActiveGroupId(groups[0].id);
  }, [groups, activeGroupId]);

  // M1 (post-ADR-027) : sessions messageries scopées USER (pas GROUP). La
  // liste est globale et la même quel que soit le groupe sélectionné.
  const sessionsQ = useMessagingSessions();
  const sessions = sessionsQ.data ?? [];
  // Le DTO `group` ne porte pas memberCount (cf. backend GroupDtoSchema) ;
  // on le dérive de la liste des membres réelle.
  const membersQ = useGroupMembers(activeGroup?.id);
  const memberCount = membersQ.data?.length ?? 0;

  // ADR-027 : plus de "channels" Discord (Discord est webview comme les autres).
  // On garde activeChannelId à null pour compat avec persistLastLocation.
  const activeChannelId: string | null = null;

  // Sessions encapsulées (WhatsApp/Messenger, cf. ADR-022 + ADR-025).
  // Pas de channels (le bridge ne sync rien) — la session entière fait office
  // d'item cliquable. Quand `activeWebviewSessionId` est set, on rend
  // WebviewProviderPane à la place de ChatView (cf. main pane plus bas).
  // ADR-027 : tous les providers sont webview (Discord inclus depuis migration).
  const webviewSessions = sessions;
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

  // WebSocket : depuis ADR-027, plus de bridge events messageries (les
  // messages restent côté provider via webview encapsulée). Le hook reste
  // monté pour ouvrir la connexion (présence, futur typing indicator) ;
  // les events killer features sont invalidés par `useKillerFeaturesWs`
  // monté au niveau Router (cf. router.tsx → RootComponent).
  useWs({
    enabled: !initializing && !!user,
    onEvent: () => undefined,
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
        activeGroup={activeGroup}
        memberCount={memberCount}
        sessions={sessions}
        webviewSessions={webviewSessions}
        activeWebviewSessionId={activeWebviewSessionId}
        pane={pane}
        userName={user.displayName}
        onSelectGroup={(g) => {
          // Polish P7 : clic sur l'icône d'un groupe → ouvre la home du
          // groupe (vue d'accueil dédiée), pas direct sur 'chat'.
          setActiveGroupId(g.id);
          setPane('group_home');
          setActiveWebviewSessionId(null);
        }}
        onLogoClick={() => {
          setPane('home');
          setPendingOpen(null);
          setActiveWebviewSessionId(null);
        }}
        onSettings={() => void navigate({ to: '/settings' })}
        onWebviewSessionSelect={(s) => {
          setActiveWebviewSessionId(s.id);
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
        {pane === 'group_home' && activeGroup && (
          <GroupHomeDashboard
            group={activeGroup}
            onNavigate={(target: GroupHomeNavTarget) => {
              setPane(target.pane);
              if (target.sourceId) {
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
  activeGroup,
  memberCount,
  sessions,
  webviewSessions,
  activeWebviewSessionId,
  pane,
  userName,
  onLogoClick,
  onSelectGroup,
  onSettings,
  onWebviewSessionSelect,
  onPaneToggle,
  onNotifSelectGroup,
  onNotifSelectPane,
  onNotifSetPendingOpen,
}: {
  groups: Group[];
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- ESLint résout `Group` comme `error type` (paths tsconfig non actif côté ESLint, dette J5b backlog)
  activeGroup: Group | null;
  memberCount: number;
  sessions: MessagingSession[];
  webviewSessions: MessagingSession[];
  activeWebviewSessionId: string | null;
  pane: Pane;
  userName: string;
  onLogoClick: () => void;
  onSelectGroup: (g: Group) => void;
  onSettings: () => void;
  onWebviewSessionSelect: (s: MessagingSession) => void;
  onPaneToggle: (p: Pane) => void;
  onNotifSelectGroup: (groupId: string) => void;
  onNotifSelectPane: (p: Pane) => void;
  onNotifSetPendingOpen: (p: { pane: Pane; sourceId: string }) => void;
}) {
  // Polish P4 (révision) : drag&drop reorder des session cards via HTML5
  // native (zero dep). L'ordre est PER-USER, stocké en localStorage —
  // chaque user a sa propre vue, pas de partage backend.
  // `orderVersion` est incrémenté à chaque write pour forcer un re-render
  // du tri (sessions × order tous deux dans le useMemo plus bas).
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [orderVersion, setOrderVersion] = useState(0);

  // Tri local des sessions selon l'ordre stocké en localStorage pour ce
  // groupe. Re-calculé quand : la liste serveur change, on switch de groupe,
  // ou on vient d'écrire un nouvel ordre (orderVersion++).
  const sortedWebviewSessions = useMemo(
    () => sortSessionsByLocalOrder(webviewSessions, activeGroup?.id ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- orderVersion sert juste à invalider le memo après un write localStorage
    [webviewSessions, activeGroup?.id, orderVersion],
  );

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

  const activeGroupId = activeGroup?.id ?? null;

  return (
    <aside
      style={{
        // Polish post-ADR-027 : 280 → 240. Largeur min qui garde les 4
        // feature buttons (event/poll/expense/todo) sur une seule ligne :
        // 240 - 20 (padding hor.) - 12 (3×gap 4) = 208 → 52px / bouton,
        // au-dessus du seuil tactile 44px.
        width: 240,
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
            // Polish P6 : indicateur Home actif en cadre léger au lieu d'un
            // fond bleu trop visible. Border 0.5px en couleur accent muted +
            // background transparent. Plus discret, ne charge pas l'œil.
            background: 'transparent',
            border: pane === 'home' ? `0.5px solid ${NX.primaryMuted}` : '0.5px solid transparent',
            cursor: 'pointer',
            padding: '4px 8px',
            margin: '-4px -8px',
            borderRadius: NX.radiusSm,
            transition: 'border-color 150ms',
            color: 'inherit',
            flex: 1,
            minWidth: 0,
          }}
          aria-label="Home nexus"
          title="Home nexus"
        >
          <Logo size={26} />
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: NX.fg,
              flex: 1,
              textAlign: 'left',
            }}
          >
            nexus
          </span>
        </button>
        {/* Polish post-ADR-027 (P5) : NotificationsBell + bouton Réglages
            ont été déplacés vers le footer profil (à côté de l'avatar) — cf.
            section "User profile footer" plus bas. Bonus : libère le bandeau
            top de la sidebar pour la drag region Tauri (cf. P2). */}
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
          // M4 (post-ADR-027) : plus de dot provider sur les pills groupe.
          // Les sessions messagerie sont scopées USER désormais, donc
          // l'association session ↔ group n'a plus de sens.
          return (
            <button
              key={g.id}
              onClick={() => onSelectGroup(g)}
              style={{
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: active ? 12 : 19,
                background: active ? NX.primary : NX.elevated,
                border: 'none',
                cursor: 'pointer',
                transition: 'border-radius 0.2s, background 0.2s',
                fontSize: 12,
                fontWeight: 700,
                color: active ? '#fff' : NX.fgMuted,
              }}
              title={g.name}
            >
              {initials}
            </button>
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
        {sortedWebviewSessions.map((s, idx) => {
          const active = s.id === activeWebviewSessionId && pane === 'chat';
          const accent = sourceColor[s.providerType];
          const isDragging = dragSourceIdx === idx;
          const showDropIndicatorAbove = dragOverIdx === idx && dragSourceIdx !== null && dragSourceIdx !== idx;
          return (
            // Polish P4 fix : `draggable` sur le DIV parent (pas le button).
            // WebView2 (Tauri Windows) gère mal `draggable` sur <button> à
            // cause du conflit avec onClick. Le div capte drag, le button
            // reste un bouton cliquable pur.
            <div
              key={s.id}
              draggable
              onDragStart={(e) => {
                setDragSourceIdx(idx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/x-nexus-session', s.id);
              }}
              onDragEnd={() => {
                setDragSourceIdx(null);
                setDragOverIdx(null);
              }}
              onDragOver={(e) => {
                if (dragSourceIdx === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverIdx !== idx) setDragOverIdx(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const src = dragSourceIdx;
                setDragOverIdx(null);
                setDragSourceIdx(null);
                if (src === null || src === idx || !activeGroup) return;
                // Polish P4 (révision) : reorder client-side via localStorage,
                // PER-USER. Pas d'appel API. `setOrderVersion` force le
                // re-mémo du tri pour refléter immédiatement le drop.
                const newOrder = sortedWebviewSessions.map((ws) => ws.id);
                const [moved] = newOrder.splice(src, 1);
                if (!moved) return;
                newOrder.splice(idx, 0, moved);
                writeSessionOrder(activeGroup.id, newOrder);
                setOrderVersion((v) => v + 1);
              }}
              style={{
                position: 'relative',
                cursor: isDragging ? 'grabbing' : 'grab',
                opacity: isDragging ? 0.5 : 1,
                userSelect: 'none',
              }}
            >
              {/* Indicateur visuel : ligne accent au-dessus du drop target. */}
              {showDropIndicatorAbove && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 6,
                    right: 6,
                    height: 2,
                    background: NX.primary,
                    borderRadius: 1,
                    pointerEvents: 'none',
                  }}
                />
              )}
              <button
                onClick={() => onWebviewSessionSelect(s)}
                style={{
                  width: 'calc(100% - 12px)',
                  margin: '1px 6px',
                  padding: '6px 10px',
                  cursor: isDragging ? 'grabbing' : 'pointer',
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
                <BrandIcon brand={s.providerType} size={16} />
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
            </div>
          );
        })}
        {webviewSessions.length === 0 && <ChannelsEmptyState sessions={sessions} />}
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
        {/* Polish P5 : NotificationsBell + bouton Réglages déplacés ici
            depuis le header sidebar. Plus de conflit avec la drag region
            Tauri (P2) qui couvre tout le bandeau supérieur. */}
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
    </aside>
  );
}

/**
 * Etat vide du pane conversations — depuis ADR-027 toutes les messageries
 * (Discord inclus) sont webview, donc on a juste besoin d'un message
 * "aucune session connectée" qui renvoie vers les Réglages.
 */
function ChannelsEmptyState({ sessions }: { sessions: MessagingSession[] }) {
  if (sessions.length === 0) {
    return (
      <div style={{ padding: '12px 14px', fontSize: 12, color: NX.fgDim, lineHeight: 1.5 }}>
        Aucune messagerie connectée sur ce groupe.
        <br />
        Ajoute Discord, WhatsApp, Messenger ou un autre service depuis les Réglages.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px', fontSize: 12, color: NX.fgDim, lineHeight: 1.5 }}>
      Sélectionne une messagerie ci-dessus pour ouvrir sa fenêtre.
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
