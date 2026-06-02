import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Avatar, BrandIcon, Logo, PhIcon } from '@/components/ui';
import { NotificationsBell } from './NotificationsBell';
import { useAuth, type LandingPreference } from '@/lib/auth';
import {
  useCreateGroup,
  useGroupMembers,
  useGroups,
  useMessagingSessions,
  type Group,
  type MessagingSession,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { useEventReminderToast, reminderTierLabel } from '@/lib/useEventReminderToast';
import { useUpdater } from '@/lib/useUpdater';
import { useWs } from '@/lib/ws';

import { EventsDashboard } from '../features/EventsDashboard';
import { ExpensesDashboard } from '../features/ExpensesDashboard';
import { PollsDashboard } from '../features/PollsDashboard';
import { TodosDashboard } from '../features/TodosDashboard';

import { UpdaterBanner } from './UpdaterBanner';
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

// ─── Persistance "largeur du blade" (post-2026-05-05) ──────────────────────
// Largeur de la sidebar gauche, ajustable par drag du handle. Bornes :
// 200px (en-dessous on ne tient plus les 4 feature buttons côte à côte) et
// 480px (au-delà on prend trop de place sur la zone main). Default 240
// (alignement historique post-ADR-027).
const LS_BLADE_WIDTH = 'nx:bladeWidth';
const BLADE_WIDTH_MIN = 200;
const BLADE_WIDTH_MAX = 480;
const BLADE_WIDTH_DEFAULT = 240;

function readBladeWidth(): number {
  if (typeof window === 'undefined') return BLADE_WIDTH_DEFAULT;
  const raw = window.localStorage.getItem(LS_BLADE_WIDTH);
  if (!raw) return BLADE_WIDTH_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return BLADE_WIDTH_DEFAULT;
  return Math.min(BLADE_WIDTH_MAX, Math.max(BLADE_WIDTH_MIN, n));
}

function writeBladeWidth(px: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_BLADE_WIDTH, String(Math.round(px)));
  } catch {
    // localStorage indisponible → ignore (la largeur revient à 240 au prochain mount).
  }
}

// ─── Persistance "ordre des sessions" USER-GLOBAL ──────────────────────────
// Depuis ADR-028, les sessions messageries sont scopées USER (pas GROUP) :
// le même set de sessions apparaît dans la sidebar peu importe le groupe
// sélectionné. Conséquence : l'ordre user-defined doit être un tableau
// global et non plus indexé par groupId. Migration legacy : à la première
// lecture si la nouvelle clé est vide on hydrate depuis n'importe quelle
// ancienne entrée scope-groupe pour ne pas perdre le travail du user.
const LS_SESSION_ORDER = 'nx:sessionOrder';
const LS_SESSION_ORDER_LEGACY_PREFIX = 'nx:sessionOrder:';

function readSessionOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_SESSION_ORDER);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    }
    // Migration legacy : si la nouvelle clé est vide, hydrater depuis la
    // première ancienne entrée scope-groupe trouvée (best-effort, on ne
    // peut pas savoir quel groupe était "le bon" — l'user retrouvera son
    // ordre sur l'un d'entre eux et pourra réorganiser les autres).
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(LS_SESSION_ORDER_LEGACY_PREFIX)) {
        const legacyRaw = window.localStorage.getItem(key);
        if (legacyRaw) {
          try {
            const parsed = JSON.parse(legacyRaw) as unknown;
            if (Array.isArray(parsed)) {
              const ids = parsed.filter((x): x is string => typeof x === 'string');
              // Hydrate la nouvelle clé + cleanup de toutes les legacy.
              window.localStorage.setItem(LS_SESSION_ORDER, JSON.stringify(ids));
              const legacyKeys: string[] = [];
              for (let j = 0; j < window.localStorage.length; j++) {
                const k = window.localStorage.key(j);
                if (k && k.startsWith(LS_SESSION_ORDER_LEGACY_PREFIX)) legacyKeys.push(k);
              }
              for (const k of legacyKeys) window.localStorage.removeItem(k);
              return ids;
            }
          } catch {
            // legacy corrompue → ignore, reste en mode "ordre par défaut"
          }
        }
      }
    }
    return [];
  } catch {
    return [];
  }
}

function writeSessionOrder(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_SESSION_ORDER, JSON.stringify(ids));
  } catch {
    // localStorage plein ou désactivé → silent (l'ordre revient au défaut au
    // prochain mount, pas critique).
  }
}

function sortSessionsByLocalOrder(sessions: MessagingSession[]): MessagingSession[] {
  if (sessions.length === 0) return sessions;
  const order = readSessionOrder();
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
}

function readLastLocation(): LastLocation {
  if (typeof window === 'undefined') {
    return { groupId: null, pane: null };
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
}

/**
 * Résout la destination de landing en fonction de la préférence user et de
 * l'état localStorage (dernière position connue). Fallback silencieux sur
 * 'home' si l'option n'est pas applicable (ex : groupe disparu).
 */
function resolveLandingDestination(
  pref: LandingPreference,
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
      setBridgeToast(
        `${provider.charAt(0).toUpperCase() + provider.slice(1)} connecté avec succès.`,
      );
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

  // Auto-updater desktop (cf. ADR-031). No-op en web pur — le hook reste
  // `idle` et le banner ne rend rien.
  const updater = useUpdater();

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

  // ADR-027 + migration 0012 : plus de "channels" Discord (Discord est webview
  // comme les autres). Le state activeChannelId et la clé localStorage
  // `nx:lastChannel` ont été retirés.

  // Sessions encapsulées (WhatsApp/Messenger, cf. ADR-022 + ADR-025).
  // Pas de channels (le bridge ne sync rien) — la session entière fait office
  // d'item cliquable. Quand `activeWebviewSessionId` est set, on rend
  // WebviewProviderPane à la place de ChatView (cf. main pane plus bas).
  // ADR-027 : tous les providers sont webview (Discord inclus depuis migration).
  const webviewSessions = sessions;
  const [activeWebviewSessionId, setActiveWebviewSessionId] = useState<string | null>(null);
  const activeWebviewSession = webviewSessions.find((s) => s.id === activeWebviewSessionId) ?? null;
  // Si la session active disparaît (delete depuis Settings), on reset
  // proprement pour ne pas afficher un pane orphelin.
  useEffect(() => {
    if (activeWebviewSessionId && !activeWebviewSession) {
      setActiveWebviewSessionId(null);
    }
  }, [activeWebviewSessionId, activeWebviewSession]);

  // ─── Largeur du blade gauche (post-2026-05-05) ──────────────────────────
  // Initialisée depuis localStorage, puis modifiée par drag du handle. Bornée
  // par BLADE_WIDTH_MIN/MAX. Persistée à chaque relâchement de souris.
  const [bladeWidth, setBladeWidth] = useState<number>(() => readBladeWidth());

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
    persistLastLocation({ groupId: activeGroupId, pane });
  }, [activeGroupId, pane]);

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
      <UpdaterBanner updater={updater} />
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
        bladeWidth={bladeWidth}
        onBladeWidthChange={setBladeWidth}
        onBladeWidthCommit={writeBladeWidth}
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
        onGroupCreated={(g) => {
          setActiveGroupId(g.id);
          setPane('group_home');
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
            groupId={activeGroup.id}
            openItemId={pendingOpen?.pane === 'event' ? pendingOpen.sourceId : null}
            onConsumeOpen={() => setPendingOpen(null)}
          />
        )}
        {pane === 'poll' && activeGroup && <PollsDashboard groupId={activeGroup.id} />}
        {pane === 'expense' && activeGroup && (
          <ExpensesDashboard
            groupId={activeGroup.id}
            openItemId={pendingOpen?.pane === 'expense' ? pendingOpen.sourceId : null}
            onConsumeOpen={() => setPendingOpen(null)}
          />
        )}
        {pane === 'todo' && activeGroup && (
          <TodosDashboard
            groupId={activeGroup.id}
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
  bladeWidth,
  onBladeWidthChange,
  onBladeWidthCommit,
  onLogoClick,
  onSelectGroup,
  onGroupCreated,
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
  bladeWidth: number;
  onBladeWidthChange: (px: number) => void;
  onBladeWidthCommit: (px: number) => void;
  onLogoClick: () => void;
  onSelectGroup: (g: Group) => void;
  onGroupCreated: (g: Group) => void;
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

  // Tri local des sessions selon l'ordre stocké en localStorage (clé
  // user-globale depuis ADR-028 : sessions scopées USER, l'ordre est
  // identique peu importe le groupe sélectionné). Re-calculé quand : la
  // liste serveur change, ou on vient d'écrire un nouvel ordre (orderVersion++).
  // Note : orderVersion est volontairement listé en dep pour forcer un
  // re-mémo après un write localStorage (la valeur n'est pas lue dans le
  // body du memo, juste utilisée comme cache buster).
  const sortedWebviewSessions = useMemo(
    () => sortSessionsByLocalOrder(webviewSessions),
    [webviewSessions, orderVersion],
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
        // Largeur ajustable par drag du handle à droite (post-2026-05-05).
        // Bornée [200, 480] côté state. Default 240 (alignement post-ADR-027 :
        // 240 - 20 padding - 12 gap = 208 → 52px par feature button).
        width: bladeWidth,
        background: NX.glassBg,
        backdropFilter: NX.glassBlur,
        WebkitBackdropFilter: NX.glassBlur,
        borderRight: `1px solid ${NX.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'relative',
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
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            margin: '-4px -8px',
            borderRadius: NX.radiusSm,
            color: 'inherit',
            flex: 1,
            minWidth: 0,
          }}
          aria-label="Home nexus"
          title="Home nexus"
        >
          {/* Indicateur universel de sélection (style Apple) : fine barre
              verticale grise discrète, capsule arrondie. Position absolue
              pour ne pas affecter le layout, top/bottom 25% pour ne pas
              prendre toute la hauteur (effet "pill" Apple HIG sidebar). */}
          {pane === 'home' && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: -2,
                top: '25%',
                bottom: '25%',
                width: 3,
                borderRadius: 1.5,
                background: NX.fgMuted,
                pointerEvents: 'none',
              }}
            />
          )}
          {/* pointer-events: none sur les enfants pour que les clics sur le
              logo SVG ou sur le texte remontent au button parent (sinon le
              SVG capte les events et le clic sur le mark ne déclenche pas
              onLogoClick). */}
          <span style={{ pointerEvents: 'none', display: 'inline-flex' }}>
            <Logo size={26} />
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: NX.fg,
              flex: 1,
              textAlign: 'left',
              pointerEvents: 'none',
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
        {/* Bouton "+" post-2026-05-05 : crée un nouveau groupe via popover.
            Style discret (dashed border + plus icon), aligné avec les pills. */}
        <NewGroupButton onCreated={onGroupCreated} />
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
          <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>{memberCount} membres</div>
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
          const isDragging = dragSourceIdx === idx;
          const showDropIndicatorAbove =
            dragOverIdx === idx && dragSourceIdx !== null && dragSourceIdx !== idx;
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
                if (src === null || src === idx) return;
                // Polish P4 (révision ADR-028) : reorder client-side via
                // localStorage, USER-GLOBAL (sessions sont scopées USER,
                // l'ordre est partagé peu importe le groupe sélectionné).
                // Pas d'appel API. `setOrderVersion` force le re-mémo du
                // tri pour refléter immédiatement le drop.
                const newOrder = sortedWebviewSessions.map((ws) => ws.id);
                const [moved] = newOrder.splice(src, 1);
                if (!moved) return;
                newOrder.splice(idx, 0, moved);
                writeSessionOrder(newOrder);
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
                  position: 'relative',
                  width: 'calc(100% - 12px)',
                  margin: '1px 6px',
                  padding: '6px 10px',
                  cursor: isDragging ? 'grabbing' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: NX.radiusXs,
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  textAlign: 'left',
                }}
                title={s.displayName}
              >
                {/* Indicateur de sélection style Apple : barre grise capsule */}
                {active && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: -2,
                      top: '22%',
                      bottom: '22%',
                      width: 3,
                      borderRadius: 1.5,
                      background: NX.fgMuted,
                      pointerEvents: 'none',
                    }}
                  />
                )}
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
              kind === 'event_reminder' ||
              kind === 'event_rsvp_requested' ||
              kind === 'event_rsvp_received'
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

      {/* === Resize handle (post-2026-05-05) ===
          Bande de 4px à cheval sur le border droit du blade. Drag horizontal
          → ajuste la largeur live (clamp [200, 480]). Mouseup → persiste en
          localStorage. On utilise pointer events pour gérer souris + trackpad
          + tactile uniformément. */}
      <BladeResizeHandle
        currentWidth={bladeWidth}
        onChange={onBladeWidthChange}
        onCommit={onBladeWidthCommit}
      />
    </aside>
  );
}

/**
 * Handle de resize positionné en absolu sur le bord droit du blade.
 * Fait BLADE_WIDTH_MIN/MAX clamping côté drag pour éviter les valeurs hors
 * bornes. Persistance différée à mouseup pour ne pas spammer localStorage
 * pendant le drag.
 */
function BladeResizeHandle({
  currentWidth,
  onChange,
  onCommit,
}: {
  currentWidth: number;
  onChange: (px: number) => void;
  onCommit: (px: number) => void;
}) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      const dx = e.clientX - st.startX;
      const next = Math.min(BLADE_WIDTH_MAX, Math.max(BLADE_WIDTH_MIN, st.startWidth + dx));
      onChange(next);
    };
    const onUp = () => {
      setDragging(false);
      dragStateRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, onChange]);

  // Commit la largeur en localStorage à la fin du drag uniquement (évite
  // d'écrire 60 fois pendant un drag de 200ms).
  // Note : currentWidth/onCommit volontairement omis des deps — on ne veut
  // déclencher que sur la transition dragging true→false.
  useEffect(() => {
    if (!dragging) onCommit(currentWidth);
  }, [dragging]);

  const active = hover || dragging;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={currentWidth}
      aria-valuemin={BLADE_WIDTH_MIN}
      aria-valuemax={BLADE_WIDTH_MAX}
      onPointerDown={(e) => {
        // Capture le pointer pour continuer à recevoir les events même
        // si la souris sort du handle pendant le drag.
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStateRef.current = { startX: e.clientX, startWidth: currentWidth };
        setDragging(true);
        e.preventDefault();
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onDoubleClick={() => {
        // Double-clic → reset à la valeur par défaut.
        onChange(BLADE_WIDTH_DEFAULT);
        onCommit(BLADE_WIDTH_DEFAULT);
      }}
      title="Glisser pour redimensionner — double-clic pour reset"
      style={{
        position: 'absolute',
        top: 0,
        right: -2,
        width: 4,
        height: '100%',
        cursor: 'col-resize',
        zIndex: 5,
        background: active ? NX.primary : 'transparent',
        opacity: active ? 0.5 : 1,
        transition: 'background 120ms, opacity 120ms',
        touchAction: 'none',
      }}
    />
  );
}

/**
 * Bouton "+" pour créer un nouveau groupe depuis la sidebar (post-2026-05-05).
 *
 * Comportement : clic → state `open=true` → affiche un input flottant
 * absolu juste sous le bouton avec un placeholder + bouton Créer. Submit →
 * appelle `useCreateGroup`, fait `onCreated(group)` à success (le parent
 * AppShell switch sur le nouveau groupe), reset le form. Escape → ferme.
 *
 * Note : on garde le UI minimal — pas de modal globale pour ne pas casser le
 * flow rapide depuis la sidebar. Pour un onboarding complet (avatar, invite),
 * l'écran dédié est `OnboardingScreen` (pas accessible depuis ici).
 */
function NewGroupButton({ onCreated }: { onCreated: (g: Group) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const createGroup = useCreateGroup();

  // Focus auto à l'ouverture.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setName('');
      setError(null);
    }
  }, [open]);

  // Fermeture sur clic extérieur.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Le nom est obligatoire.');
      return;
    }
    setError(null);
    try {
      const g = await createGroup.mutateAsync({ name: trimmed });
      setOpen(false);
      onCreated(g);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur à la création.');
    }
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Nouveau groupe"
        title="Nouveau groupe"
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          background: open ? NX.elevated : 'transparent',
          border: `1px dashed ${NX.borderStrong}`,
          cursor: 'pointer',
          color: NX.fgMuted,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 120ms, color 120ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = NX.elevated;
          e.currentTarget.style.color = NX.fg;
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = NX.fgMuted;
        }}
      >
        <PhIcon name="plus" size={16} />
      </button>
      {open && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: 44,
            left: 0,
            zIndex: 30,
            width: 240,
            padding: 10,
            borderRadius: NX.radius,
            background: NX.surface,
            border: `1px solid ${NX.border}`,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter') void submit();
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: NX.fg }}>Nouveau groupe</div>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="La Bande du 11e"
            disabled={createGroup.isPending}
            style={{
              padding: '8px 10px',
              fontSize: 13,
              borderRadius: NX.radiusSm,
              border: `1px solid ${NX.border}`,
              background: NX.bg,
              color: NX.fg,
              outline: 'none',
            }}
          />
          {error && <div style={{ fontSize: 11, color: NX.error }}>{error}</div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                borderRadius: NX.radiusSm,
                background: 'transparent',
                color: NX.fgMuted,
                border: `1px solid ${NX.border}`,
                cursor: 'pointer',
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={createGroup.isPending || !name.trim()}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: NX.radiusSm,
                background: NX.primary,
                color: '#fff',
                border: 'none',
                cursor: createGroup.isPending || !name.trim() ? 'not-allowed' : 'pointer',
                opacity: createGroup.isPending || !name.trim() ? 0.6 : 1,
              }}
            >
              {createGroup.isPending ? 'Création…' : 'Créer'}
            </button>
          </div>
        </div>
      )}
    </div>
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
          <div style={{ fontSize: 16, fontWeight: 600, color: NX.fg }}>
            Pas encore de messagerie connectee
          </div>
          <div style={{ fontSize: 13, maxWidth: 320, lineHeight: 1.6 }}>
            Branche Discord, WhatsApp ou Messenger depuis les Reglages.
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, color: NX.fg }}>
            Selectionne une conversation
          </div>
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
