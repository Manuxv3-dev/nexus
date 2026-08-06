/**
 * Variante mobile de l'AppShell — navigation par stack au lieu du 3-pane.
 *
 * Trois écrans empilés :
 *  1. Liste des groupes
 *  2. Liste des sessions messageries (+ killer features tabs)
 *  3. Conversation (webview encapsulée) ou panel feature
 *
 * Conformément à ADR-014, on reste en React web (pas RN). Le stack est
 * géré localement par `screen` ; un swipe-back gesture pourra venir en J4c.
 *
 * Depuis ADR-027 (universalisation webview messaging) : plus de channels
 * Discord, plus de ChatView natif. Toutes les sessions ouvrent la webview
 * encapsulée du provider correspondant (Discord/WhatsApp/Messenger/...).
 *
 * Deep-link push (MAN-151) : symétrique à `AppShell` (cf. MAN-143 Phase 2
 * Task 4), avec la même lecture des query params `/app?groupId&pane&sourceId`
 * via `readPushDeepLinkParams` (`lib/pushDeepLink.ts`, module partagé — DRY
 * entre les deux shells) et le même mécanisme `pendingOpen`, adapté à la
 * navigation par stack : au lieu de juste changer de `pane`, on force aussi
 * `stack` sur `'detail'` pour amener l'utilisateur directement sur l'écran
 * cible plutôt que sur la liste des groupes.
 */
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import {
  CreateGroupForm,
  GROUPS_EMPTY_STATE_BODY,
  GROUPS_EMPTY_STATE_TITLE,
} from '@/components/groups/CreateGroupForm';
import { Avatar, Logo, PhIcon, type PhIconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { readPushDeepLinkParams, type PushDeepLinkPane } from '@/lib/pushDeepLink';
import {
  useGroupMembers,
  useGroups,
  useMessagingSessions,
  type Group,
  type MessagingSession,
} from '@/lib/queries';
import { NX, sourceColor } from '@/lib/tokens';
import { useWs } from '@/lib/ws';

import { EventsDashboard } from '../features/EventsDashboard';
import { ExpensesDashboard } from '../features/ExpensesDashboard';
import { PollsDashboard } from '../features/PollsDashboard';
import { TodosDashboard } from '../features/TodosDashboard';

import { GroupMenu } from './GroupMenu';
import { OnboardingTourBanner } from './OnboardingTourBanner';
import { WebviewProviderPane } from './WebviewProviderPane';

// Pane : la vue active dans le stack 'detail' du mobile.
type Pane = 'chat' | 'event' | 'poll' | 'expense' | 'todo';
type Stack = 'groups' | 'channels' | 'detail';

export function MobileShell() {
  const navigate = useNavigate();
  const { user, initializing } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];

  const [stack, setStack] = useState<Stack>('groups');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('chat');
  // Deep-link push (MAN-151) : même mécanisme `pendingOpen` que `AppShell`
  // (cf. `EventsDashboard`/`ExpensesDashboard`/`TodosDashboard` — le
  // dashboard consomme via prop `openItemId` + callback `onConsumeOpen`).
  const [pendingOpen, setPendingOpen] = useState<{
    pane: PushDeepLinkPane;
    sourceId: string;
  } | null>(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  // M1 (post-ADR-027) : sessions scopées USER (pas GROUP).
  const sessionsQ = useMessagingSessions();
  const sessions = sessionsQ.data ?? [];
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const membersQ = useGroupMembers(activeGroup?.id);
  const memberCount = membersQ.data?.length ?? 0;

  useWs({ enabled: !initializing && !!user, onEvent: () => undefined });

  useEffect(() => {
    if (!activeGroupId && groups[0]) {
      setActiveGroupId(groups[0].id);
    }
  }, [groups, activeGroupId]);

  // ─── Deep-link push (MAN-151) ────────────────────────────────────────────
  // Portage de la logique `AppShell` (MAN-143 Phase 2 Task 4) côté mobile —
  // manquait entièrement (cf. ticket). Consomme les query params posés par
  // `buildDeepLinkUrl`/`buildDeepLinkSearch` via `readPushDeepLinkParams`
  // (`lib/pushDeepLink.ts`, module partagé avec `AppShell` — DRY). Déclaré
  // APRÈS l'effet "groupe par défaut" ci-dessus : les deux tournent dans le
  // même commit React tant que `activeGroupId` est encore `null`, et
  // `setActiveGroupId` appelé en second l'emporte — l'ordre garantit que la
  // cible du deep-link prime sur `groups[0]` (même agencement qu'`AppShell`).
  //
  // La query string vient de l'état du router, PAS de `window.location` :
  // `/app` est une route unique, et `usePushNavigate` (fenêtre déjà ouverte)
  // fait une navigation search-only qui ne remonte pas ce composant.
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  useEffect(() => {
    if (!user || groupsQ.isLoading) return;
    const deepLink = readPushDeepLinkParams(searchStr);
    if (!deepLink) return;
    // Usage unique : on nettoie l'URL même si la cible finit par être
    // rejetée, sinon un refresh la rejouerait indéfiniment.
    void navigate({ to: '/app', search: {}, replace: true });
    // `groupId` vient d'une URL, donc d'une source non fiable (lien forgé,
    // groupe quitté depuis l'envoi du push) — cf. `AppShell` pour le même
    // raisonnement. Sans cette validation, `activeGroup` pourrait retomber
    // sur un groupe qui n'est pas celui ciblé par la notif.
    if (!groups.some((g) => g.id === deepLink.groupId)) return;
    setActiveGroupId(deepLink.groupId);
    setPane(deepLink.pane);
    setPendingOpen(deepLink.sourceId ? { pane: deepLink.pane, sourceId: deepLink.sourceId } : null);
    setStack('detail');
  }, [user, navigate, searchStr, groups, groupsQ.isLoading]);

  if (initializing) {
    return (
      <div
        className="nx-bg-grid"
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: NX.primary, animation: 'spinSlow 1s linear infinite' }}>⟳</span>
      </div>
    );
  }

  return (
    <div
      // Animation d'entrée (MAN-111 Task 1) : cf. AppShell.tsx pour le détail
      // du raisonnement (classe statique posée une fois dans le JSX, jouée au
      // montage uniquement, jamais rejouée par un re-render).
      className="animate-in fade-in zoom-in-95 duration-normal ease-nx nx-bg-grid"
      style={{
        height: '100vh',
        color: NX.fg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <OnboardingTourBanner />
      {stack === 'groups' && (
        <GroupsList
          groups={groups}
          isPending={groupsQ.isPending}
          isError={groupsQ.isError}
          activeGroupId={activeGroupId}
          userName={user?.displayName ?? '?'}
          onSelect={(g) => {
            setActiveGroupId(g.id);
            setActiveSessionId(null);
            // Navigation manuelle vers un autre groupe : une éventuelle
            // cible de deep-link encore en attente n'a plus lieu d'être.
            setPendingOpen(null);
            setStack('channels');
          }}
          onSettings={() => void navigate({ to: '/settings' })}
        />
      )}
      {stack === 'channels' && activeGroup && (
        <SessionsListMobile
          group={activeGroup}
          memberCount={memberCount}
          sessions={sessions}
          onBack={() => setStack('groups')}
          onSessionSelect={(s) => {
            setActiveSessionId(s.id);
            setPane('chat');
            setPendingOpen(null);
            setStack('detail');
          }}
          onPickFeature={(p) => {
            setPane(p);
            // Sélection manuelle du dashboard : pas de deep-link à consommer.
            setPendingOpen(null);
            setStack('detail');
          }}
        />
      )}
      {stack === 'detail' && activeGroup && (
        <DetailScreen
          onBack={() => setStack('channels')}
          pane={pane}
          activeSession={activeSession}
          groupId={activeGroup.id}
          openItemId={pendingOpen?.pane === pane ? pendingOpen.sourceId : null}
          onConsumeOpen={() => setPendingOpen(null)}
        />
      )}
    </div>
  );
}

function GroupsList({
  groups,
  isPending,
  isError,
  activeGroupId,
  userName,
  onSelect,
  onSettings,
}: {
  groups: Group[];
  /** `groupsQ.isPending` — PAS `isLoading` : `useGroups` est une query
   *  `enabled: !!userId && !initializing` (désactivée pendant la fenêtre
   *  pré-auth), et en TanStack Query v5 une query désactivée rapporte
   *  `isLoading === false` alors que `isPending === true`. Utiliser
   *  `isLoading` laisserait le même trou ouvert pendant cette fenêtre
   *  (MAN-231, revue). */
  isPending: boolean;
  isError: boolean;
  activeGroupId: string | null;
  userName: string;
  onSelect: (g: Group) => void;
  /** Navigue vers `/settings` — cf. `AppShell.onSettings`, même contrat. */
  onSettings: () => void;
}) {
  // Point d'entrée création de groupe (MAN-231) : `CreateGroupForm`
  // (MAN-200) est monté inline sous "Tes groupes" plutôt qu'en popover
  // flottant comme `NewGroupButton` (AppShell) — pas de place fiable pour un
  // positionnement absolu sur un viewport mobile étroit. `closeOnOutsideClick`
  // n'est donc pas utilisé ici, même raisonnement que `CreateGroupButton`
  // (GroupsSection.tsx) : un form inline n'a pas besoin de se fermer au clic
  // extérieur, `onClose` (Annuler/Escape/succès) suffit.
  const [creatingGroup, setCreatingGroup] = useState(false);
  // `isPending`/`isError` gardent l'état vide honnête (MAN-231, revue) :
  // avant ce garde-fou, `groups.length === 0` était aussi vrai pendant le
  // chargement ET après un échec réseau (offline, 500, token expiré — banal
  // sur mobile), ce qui affichait "Tu n'appartiens à aucun groupe" à un
  // utilisateur qui en a, l'invitant à en recréer un en double. Même logique
  // que `GroupsSection.tsx` (`isEmpty = !isPending && !isError && length === 0`).
  const isEmpty = !isPending && !isError && groups.length === 0;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setCreatingGroup((v) => !v)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: NX.elevated,
              border: 'none',
              cursor: 'pointer',
            }}
            aria-label="Nouveau groupe"
          >
            <PhIcon name="plus" size={18} color={NX.fgMuted} />
          </button>
          <button
            type="button"
            onClick={onSettings}
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
        </div>
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
        {creatingGroup ? (
          <div style={{ padding: '0 4px 14px' }}>
            <CreateGroupForm prominent={isEmpty} onClose={() => setCreatingGroup(false)} />
          </div>
        ) : isPending ? (
          <div style={{ padding: '12px 4px', fontSize: 12, color: NX.fgMuted }}>Chargement…</div>
        ) : isError ? (
          <div style={{ padding: '12px 4px', fontSize: 12, color: NX.error }}>
            Impossible de charger tes groupes.
          </div>
        ) : (
          isEmpty && <GroupsEmptyStateMobile onCreate={() => setCreatingGroup(true)} />
        )}
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

/**
 * État vide de la liste des groupes côté mobile (MAN-231) — miroir simplifié
 * de `GroupsEmptyState` (`screens/settings/GroupsSection.tsx`) : avant ce
 * correctif, un mobinaute avec zéro groupe n'avait strictement aucune action
 * possible (cf. ticket).
 */
function GroupsEmptyStateMobile({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      data-testid="mobile-groups-empty-state"
      style={{
        margin: '4px 4px 16px',
        padding: '28px 20px',
        borderRadius: NX.radius,
        border: `1px dashed ${NX.border}`,
        background: NX.elevated,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: NX.fg }}>{GROUPS_EMPTY_STATE_TITLE}</div>
      <div style={{ fontSize: 12, color: NX.fgDim, maxWidth: 280 }}>{GROUPS_EMPTY_STATE_BODY}</div>
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 16px',
          borderRadius: NX.radiusSm,
          border: 'none',
          background: NX.primary,
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <PhIcon name="plus" size={14} color="#fff" />
        Créer un groupe
      </button>
    </div>
  );
}

function SessionsListMobile({
  group,
  memberCount,
  sessions,
  onBack,
  onSessionSelect,
  onPickFeature,
}: {
  group: Group;
  memberCount: number;
  sessions: MessagingSession[];
  onBack: () => void;
  onSessionSelect: (s: MessagingSession) => void;
  onPickFeature: (p: 'event' | 'poll' | 'expense' | 'todo') => void;
}) {
  const features: {
    id: 'event' | 'poll' | 'expense' | 'todo';
    icon: PhIconName;
    color: string;
    label: string;
  }[] = [
    { id: 'event', icon: 'calendarBlank', color: NX.primaryText, label: 'Événements' },
    { id: 'poll', icon: 'chartBar', color: NX.info, label: 'Sondages' },
    { id: 'expense', icon: 'currencyDollar', color: NX.warning, label: 'Dépenses' },
    { id: 'todo', icon: 'listChecks', color: NX.accent, label: 'Listes' },
  ];

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
          <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>{memberCount} membres</div>
        </div>
        <div style={{ position: 'relative' }}>
          <GroupMenu group={group} />
        </div>
      </header>

      <div
        style={{ padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}
      >
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
        {sessions.length === 0 && (
          <div style={{ padding: '12px 16px', fontSize: 12, color: NX.fgDim, lineHeight: 1.5 }}>
            Aucune messagerie connectée. Branche-en une depuis les Réglages côté desktop.
          </div>
        )}
        {sessions.map((s) => {
          const accent = sourceColor[s.providerType];
          return (
            <button
              key={s.id}
              onClick={() => onSessionSelect(s)}
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
                  background: accent,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 14, color: NX.fg, flex: 1 }}>{s.displayName}</span>
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
  activeSession,
  groupId,
  openItemId,
  onConsumeOpen,
}: {
  onBack: () => void;
  pane: Pane;
  activeSession: MessagingSession | null;
  /** Groupe actif du stack mobile — cf. MAN-151 : les dashboards features en
   *  avaient besoin pour scoper leurs requêtes, ce que le shell mobile ne
   *  fournissait pas du tout avant ce correctif. */
  groupId: string;
  /** Item à ouvrir au montage (deep-link push/notif), cf. `pendingOpen` dans
   *  `MobileShell` — même contrat que `AppShell`. */
  openItemId: string | null;
  onConsumeOpen: () => void;
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
          {pane === 'chat' && activeSession ? activeSession.displayName : title(pane)}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {pane === 'chat' && activeSession ? (
          <WebviewProviderPane session={activeSession} />
        ) : pane === 'event' ? (
          <EventsDashboard
            groupId={groupId}
            openItemId={openItemId}
            onConsumeOpen={onConsumeOpen}
          />
        ) : pane === 'poll' ? (
          <PollsDashboard groupId={groupId} />
        ) : pane === 'expense' ? (
          <ExpensesDashboard
            groupId={groupId}
            openItemId={openItemId}
            onConsumeOpen={onConsumeOpen}
          />
        ) : pane === 'todo' ? (
          <TodosDashboard groupId={groupId} openItemId={openItemId} onConsumeOpen={onConsumeOpen} />
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
