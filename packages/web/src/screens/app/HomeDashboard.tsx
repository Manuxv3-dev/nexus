/**
 * HomeDashboard — feed personnel trans-groupes (cf. ADR-024).
 *
 * Rendu dans la zone main de AppShell quand `pane === 'home'`. Pas de groupe
 * actif requis : on agrège tout via `GET /api/v1/home/feed`.
 *
 * Layout :
 *   ┌──────────── Hero greeting ────────────┐
 *   ├──────────── Section cards (2 col) ────┤
 *   │  À l'agenda     │  Tu dois...         │
 *   │  Mes tâches     │  Tes groupes        │
 *   ├──────────── Pending RSVPs (full row) ─┤
 *
 * Chaque card est cliquable et déclenche `onNavigate({ groupId, pane,
 * sourceId? })` qui est géré côté AppShell pour switcher de groupe et
 * d'item (deep-link existant utilisé par NotificationsBell).
 */
import { useMemo } from 'react';

import { PhIcon, type PhIconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useGroups,
  useHomeFeed,
  type HomeAssignedTodoItem,
  type HomeGroupUnreadItem,
  type HomePendingPollItem,
  type HomePendingRsvpItem,
  type HomeUnsettledExpenseItem,
  type HomeUpcomingEventItem,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { ActivityTimeline } from './ActivityTimeline';
import { WeekCalendar } from './WeekCalendar';

export interface HomeNavTarget {
  groupId: string;
  pane: 'chat' | 'event' | 'poll' | 'expense' | 'todo';
  sourceId?: string;
}

interface HomeDashboardProps {
  onNavigate: (target: HomeNavTarget) => void;
}

export function HomeDashboard({ onNavigate }: HomeDashboardProps) {
  const user = useAuth((s) => s.user);
  const feedQ = useHomeFeed();
  const feed = feedQ.data;

  const greeting = useMemo(() => greetingFor(new Date(), user?.displayName ?? 'Bienvenue'), [user]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        color: NX.fg,
      }}
    >
      {/* === Header sobre (pas FeatureShell : pas de feature attachée) === */}
      <header
        style={{
          padding: `${NX.spaceDashboard}px ${NX.spaceDashboardLg}px ${NX.spaceDashboard - 4}px`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          borderBottom: `0.5px solid ${NX.border}`,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: NX.primaryMuted,
            color: NX.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PhIcon name="house" size={20} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>{greeting}</div>
          <div style={{ fontSize: 12, color: NX.fgMuted, marginTop: 2 }}>
            Ce qui t'attend sur tes groupes
          </div>
        </div>
      </header>

      {/* === Body scroll === */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: `${NX.spaceDashboard}px ${NX.spaceDashboardLg}px ${NX.spaceDashboardLg}px`,
        }}
      >
        {feedQ.isLoading && !feed ? (
          <div style={{ padding: 40, textAlign: 'center', color: NX.fgDim, fontSize: 13 }}>
            Chargement…
          </div>
        ) : feedQ.isError ? (
          <div style={{ padding: 40, textAlign: 'center', color: NX.error, fontSize: 13 }}>
            Impossible de charger ton feed pour le moment.
          </div>
        ) : feed ? (
          <HomeContent feed={feed} onNavigate={onNavigate} />
        ) : null}
      </main>
    </div>
  );
}

function HomeContent({
  feed,
  onNavigate,
}: {
  feed: NonNullable<ReturnType<typeof useHomeFeed>['data']>;
  onNavigate: (target: HomeNavTarget) => void;
}) {
  // Note : on ne fait plus de short-circuit "all empty" → HomeFullEmpty
  // depuis post-2026-05-05. Le user a explicitement demandé que le
  // calendrier semaine + l'activité récente soient toujours visibles, y
  // compris quand tous les compteurs métier sont à zéro. Le composant
  // HomeFullEmpty est conservé pour usage futur éventuel (vraiment rien à
  // afficher = pas de groupe), mais le cas est aujourd'hui couvert par le
  // CTA "Crée ton 1er groupe" inside QuickActions.

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Quick Actions : 4 CTA pour créer rapidement (post-2026-05-05) */}
      <QuickActions onNavigate={onNavigate} />

      {/* Mini-calendrier semaine : Lundi → Dimanche de la semaine en cours,
          today highlighted. Toujours affiché même sans event. */}
      <WeekCalendar
        events={feed.upcomingEvents}
        onEventClick={(e) => onNavigate({ groupId: e.groupId, pane: 'event', sourceId: e.id })}
      />

      {/* Activité récente cross-groupes (cf. ADR-029, Bloc E HomeDashboard).
          Placé directement sous le calendrier semaine pour la priorité visuelle. */}
      <ActivitySection onNavigate={onNavigate} />

      {/* Balance dépenses synthétisée : "Tu dois X€ à Y" agrégé par payeur */}
      {feed.unsettledExpenses.length > 0 ? (
        <ExpenseBalance expenses={feed.unsettledExpenses} />
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 14,
        }}
      >
        <Card
          icon="calendarBlank"
          color={NX.featEvents}
          colorBg={NX.featEventsBg}
          title="RSVP en attente"
          count={feed.pendingRsvps.length}
          empty="Tu as répondu à tous les events à venir."
        >
          {feed.pendingRsvps.map((it) => (
            <PendingRsvpRow key={it.id} item={it} onNavigate={onNavigate} />
          ))}
        </Card>

        <Card
          icon="currencyDollar"
          color={NX.featExpenses}
          colorBg={NX.featExpensesBg}
          title="Tu dois encore payer"
          count={feed.unsettledExpenses.length}
          empty="Aucune dépense en attente."
        >
          {feed.unsettledExpenses.map((it) => (
            <UnsettledExpenseRow key={it.id} item={it} onNavigate={onNavigate} />
          ))}
        </Card>

        <Card
          icon="listChecks"
          color={NX.featTodo}
          colorBg={NX.featTodoBg}
          title="Mes tâches"
          count={feed.assignedTodos.length}
          empty="Aucune tâche assignée."
        >
          {feed.assignedTodos.map((it) => (
            <AssignedTodoRow key={it.id} item={it} onNavigate={onNavigate} />
          ))}
        </Card>

        <Card
          icon="calendarBlank"
          color={NX.featEvents}
          colorBg={NX.featEventsBg}
          title="Mes prochains events"
          count={feed.upcomingEvents.length}
          empty="Pas d'event confirmé prévu."
        >
          {feed.upcomingEvents.map((it) => (
            <UpcomingEventRow key={it.id} item={it} onNavigate={onNavigate} />
          ))}
        </Card>

        <Card
          icon="chartBar"
          color={NX.featPolls}
          colorBg={NX.featPollsBg}
          title="Sondages en attente"
          count={feed.pendingPolls.length}
          empty="Pas de sondage à voter."
        >
          {feed.pendingPolls.map((it) => (
            <PendingPollRow key={it.id} item={it} onNavigate={onNavigate} />
          ))}
        </Card>
      </div>

      {feed.unreadByGroup.length > 0 ? (
        <Card
          icon="bell"
          color={NX.accent}
          colorBg={NX.accentBg}
          title="Activité non lue"
          count={feed.unreadByGroup.reduce((s, g) => s + g.count, 0)}
          empty="Tout est lu."
        >
          {feed.unreadByGroup
            .slice()
            .sort((a, b) => b.count - a.count)
            .map((it) => (
              <UnreadGroupRow key={it.groupId} item={it} onNavigate={onNavigate} />
            ))}
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Section Activité récente (cf. ADR-029, Bloc E HomeDashboard).
 * Wrappe ActivityTimeline dans une section style "Card" mais sans utiliser
 * la primitive Card (qui s'attend à un count/empty figé alors qu'ici on
 * délègue les états loading/error/empty au composant timeline).
 */
function ActivitySection({ onNavigate }: { onNavigate: (t: HomeNavTarget) => void }) {
  return (
    <section
      style={{
        background: NX.surface,
        border: `1px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: '14px 14px 12px',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: NX.accentBg,
            color: NX.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PhIcon name="clock" size={15} />
        </div>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: NX.fg }}>Activité récente</div>
      </header>
      <ActivityTimeline
        showGroupChip
        onNavigate={(t) => {
          // ActivityNavTarget → HomeNavTarget : la pane 'chat' n'est pas
          // émise par ActivityTimeline pour l'instant (pas de kind chat).
          onNavigate({
            groupId: t.groupId,
            pane: t.pane,
            ...(t.sourceId !== undefined ? { sourceId: t.sourceId } : {}),
          });
        }}
      />
    </section>
  );
}

// ─────────────────────── Card primitive ─────────────────────────

function Card({
  icon,
  color,
  colorBg,
  title,
  count,
  empty,
  children,
}: {
  icon: PhIconName;
  color: string;
  colorBg: string;
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  const hasItems = count > 0;
  return (
    <section
      style={{
        background: NX.surface,
        border: `1px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: '14px 14px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: colorBg,
            color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PhIcon name={icon} size={15} />
        </div>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: NX.fg }}>{title}</div>
        {hasItems ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: NX.radiusPill,
              background: colorBg,
              color,
            }}
          >
            {count}
          </span>
        ) : null}
      </header>
      {hasItems ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
      ) : (
        <div style={{ padding: '12px 4px', fontSize: 12, color: NX.fgDim }}>{empty}</div>
      )}
    </section>
  );
}

// ─────────────────────── Rows par section ───────────────────────

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 6px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        borderRadius: NX.radiusSm,
        textAlign: 'left',
        color: 'inherit',
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = NX.elevated;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

function GroupChip({ name }: { name: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: NX.fgDim,
        padding: '2px 7px',
        borderRadius: NX.radiusPill,
        background: NX.elevated,
        flexShrink: 0,
      }}
    >
      {name}
    </span>
  );
}

function PendingRsvpRow({
  item,
  onNavigate,
}: {
  item: HomePendingRsvpItem;
  onNavigate: (t: HomeNavTarget) => void;
}) {
  return (
    <RowButton
      onClick={() => onNavigate({ groupId: item.groupId, pane: 'event', sourceId: item.id })}
    >
      <PhIcon name="calendarBlank" size={14} color={NX.featEvents} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: NX.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.title}
        </div>
        <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 1 }}>
          {formatRelativeDate(item.startsAt)}
        </div>
      </div>
      <GroupChip name={item.groupName} />
    </RowButton>
  );
}

function UnsettledExpenseRow({
  item,
  onNavigate,
}: {
  item: HomeUnsettledExpenseItem;
  onNavigate: (t: HomeNavTarget) => void;
}) {
  return (
    <RowButton
      onClick={() => onNavigate({ groupId: item.groupId, pane: 'expense', sourceId: item.id })}
    >
      <PhIcon name="currencyDollar" size={14} color={NX.featExpenses} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: NX.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.description}
        </div>
        <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 1 }}>
          Tu dois {formatMoney(item.shareCents, item.currency)} à {item.paidByName}
        </div>
      </div>
      <GroupChip name={item.groupName} />
    </RowButton>
  );
}

function AssignedTodoRow({
  item,
  onNavigate,
}: {
  item: HomeAssignedTodoItem;
  onNavigate: (t: HomeNavTarget) => void;
}) {
  return (
    <RowButton
      onClick={() => onNavigate({ groupId: item.groupId, pane: 'todo', sourceId: item.id })}
    >
      <PhIcon name="listChecks" size={14} color={NX.featTodo} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: NX.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.text}
        </div>
        <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 1 }}>{item.listTitle}</div>
      </div>
      <GroupChip name={item.groupName} />
    </RowButton>
  );
}

function UpcomingEventRow({
  item,
  onNavigate,
}: {
  item: HomeUpcomingEventItem;
  onNavigate: (t: HomeNavTarget) => void;
}) {
  return (
    <RowButton
      onClick={() => onNavigate({ groupId: item.groupId, pane: 'event', sourceId: item.id })}
    >
      <PhIcon name="calendarBlank" size={14} color={NX.featEvents} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: NX.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.title}
        </div>
        <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 1 }}>
          {formatRelativeDate(item.startsAt)}
          {item.location ? ` · ${item.location}` : ''}
        </div>
      </div>
      <GroupChip name={item.groupName} />
    </RowButton>
  );
}

function PendingPollRow({
  item,
  onNavigate,
}: {
  item: HomePendingPollItem;
  onNavigate: (t: HomeNavTarget) => void;
}) {
  const closesLabel = item.closesAt
    ? `Clôture ${formatRelativeDate(item.closesAt)}`
    : `${item.optionCount} option${item.optionCount > 1 ? 's' : ''}`;
  return (
    <RowButton
      onClick={() => onNavigate({ groupId: item.groupId, pane: 'poll', sourceId: item.id })}
    >
      <PhIcon name="chartBar" size={14} color={NX.featPolls} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: NX.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.question}
        </div>
        <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 1 }}>{closesLabel}</div>
      </div>
      <GroupChip name={item.groupName} />
    </RowButton>
  );
}

function UnreadGroupRow({
  item,
  onNavigate,
}: {
  item: HomeGroupUnreadItem;
  onNavigate: (t: HomeNavTarget) => void;
}) {
  return (
    <RowButton onClick={() => onNavigate({ groupId: item.groupId, pane: 'chat' })}>
      <PhIcon name="bell" size={14} color={NX.accent} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: NX.fg }}>{item.groupName}</div>
        <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 1 }}>
          {item.count} notification{item.count > 1 ? 's' : ''} non lue{item.count > 1 ? 's' : ''}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: NX.radiusPill,
          background: NX.accentBg,
          color: NX.accent,
        }}
      >
        {item.count}
      </span>
    </RowButton>
  );
}

// Note post-2026-05-05 : composant HomeFullEmpty supprimé. Le cas "rien à
// afficher" est désormais couvert par le CTA "Crée ton 1er groupe" inside
// QuickActions + le calendrier semaine vide + la timeline d'activité vide,
// qui sont auto-suffisants visuellement.

// ─────────────────────── Format helpers ─────────────────────────

function greetingFor(now: Date, name: string): string {
  const h = now.getHours();
  if (h < 6) return `Bonsoir ${name}`;
  if (h < 12) return `Salut ${name}`;
  if (h < 18) return `Bon après-midi ${name}`;
  return `Bonsoir ${name}`;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.round((d.getTime() - now) / 60_000);
  const abs = Math.abs(diffMin);
  if (abs < 60) {
    return diffMin >= 0 ? `Dans ${abs} min` : `Il y a ${abs} min`;
  }
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24) {
    return diffH >= 0 ? `Dans ${diffH} h` : `Il y a ${Math.abs(diffH)} h`;
  }
  const diffD = Math.round(diffH / 24);
  if (Math.abs(diffD) < 7) {
    return diffD >= 0 ? `Dans ${diffD} j` : `Il y a ${Math.abs(diffD)} j`;
  }
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // Fallback si la devise n'est pas reconnue par Intl.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// ─────────────────────── Quick Actions (post-2026-05-05) ────────

/**
 * Bloc 4 CTA pour créer rapidement event / poll / expense / todo.
 * Les CTA naviguent vers le dashboard correspondant du dernier groupe
 * actif (ou le 1er groupe disponible si pas de "dernier"). Si l'user
 * n'a aucun groupe, le bloc affiche un CTA "Crée ton 1er groupe".
 */
function QuickActions({ onNavigate }: { onNavigate: (t: HomeNavTarget) => void }) {
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];

  // Choix du groupe cible : LS_LAST_GROUP s'il existe encore dans la liste,
  // sinon le 1er groupe (ordre serveur). Pas de fallback global => CTA cachés
  // si l'user n'a aucun groupe (afficher un message d'onboarding à la place).
  const targetGroupId = useMemo(() => {
    if (groups.length === 0) return null;
    if (typeof window === 'undefined') return groups[0]?.id ?? null;
    const last = window.localStorage.getItem('nx:lastGroup');
    if (last && groups.some((g) => g.id === last)) return last;
    return groups[0]?.id ?? null;
  }, [groups]);

  if (groups.length === 0) {
    return (
      <section
        style={{
          background: NX.surface,
          border: `1px solid ${NX.border}`,
          borderRadius: NX.radiusLg,
          padding: '20px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: NX.primaryMuted,
            color: NX.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PhIcon name="users" size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: NX.fg }}>Crée ton 1er groupe</div>
          <div style={{ fontSize: 12, color: NX.fgDim, marginTop: 2 }}>
            Pour commencer à organiser events, dépenses et todos avec tes amis.
          </div>
        </div>
      </section>
    );
  }

  const actions: {
    pane: HomeNavTarget['pane'];
    icon: PhIconName;
    color: string;
    bg: string;
    label: string;
  }[] = [
    {
      pane: 'event',
      icon: 'calendarBlank',
      color: NX.featEvents,
      bg: NX.featEventsBg,
      label: 'Nouvel event',
    },
    {
      pane: 'poll',
      icon: 'chartBar',
      color: NX.featPolls,
      bg: NX.featPollsBg,
      label: 'Nouveau sondage',
    },
    {
      pane: 'expense',
      icon: 'currencyDollar',
      color: NX.featExpenses,
      bg: NX.featExpensesBg,
      label: 'Nouvelle dépense',
    },
    {
      pane: 'todo',
      icon: 'listChecks',
      color: NX.featTodo,
      bg: NX.featTodoBg,
      label: 'Nouvelle todo',
    },
  ];

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10,
      }}
    >
      {actions.map((a) => (
        <button
          key={a.pane}
          type="button"
          onClick={() => {
            if (!targetGroupId) return;
            onNavigate({ groupId: targetGroupId, pane: a.pane });
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            background: NX.surface,
            border: `1px solid ${NX.border}`,
            borderRadius: NX.radiusLg,
            cursor: 'pointer',
            textAlign: 'left',
            color: 'inherit',
            transition: 'background 120ms, border-color 120ms, transform 80ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = NX.elevated;
            e.currentTarget.style.borderColor = NX.borderStrong;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = NX.surface;
            e.currentTarget.style.borderColor = NX.border;
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: a.bg,
              color: a.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <PhIcon name={a.icon} size={16} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: NX.fg }}>{a.label}</div>
        </button>
      ))}
    </section>
  );
}

// ─────────────────────── Mini-calendrier semaine (post-2026-05-05) ──

// Note post-2026-05-05 : WeekCalendar a été extrait dans `./WeekCalendar.tsx`
// pour être partagé avec GroupHomeDashboard. L'ancienne implémentation locale
// (incluant son sous-composant WeekDayCard) a été retirée. Cf. git log pour
// récupérer l'ancien code si besoin.

// ─────────────────────── Balance dépenses (post-2026-05-05) ─────

/**
 * Synthèse "Tu dois X€ à Y" agrégé par payeur depuis unsettledExpenses.
 * Format Tricount-style : 1 ligne par personne à qui je dois de l'argent,
 * avec le total dû et le nombre de dépenses.
 */
function ExpenseBalance({ expenses }: { expenses: HomeUnsettledExpenseItem[] }) {
  const balance = useMemo(() => {
    // Map<paidById, { name, totalCents, currency, count }>
    const byPayer = new Map<
      string,
      { name: string; totalCents: number; currency: string; count: number }
    >();
    for (const e of expenses) {
      const existing = byPayer.get(e.paidById);
      if (existing) {
        existing.totalCents += e.shareCents;
        existing.count += 1;
      } else {
        byPayer.set(e.paidById, {
          name: e.paidByName,
          totalCents: e.shareCents,
          currency: e.currency,
          count: 1,
        });
      }
    }
    return Array.from(byPayer.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [expenses]);

  if (balance.length === 0) return null;

  const grandTotalCents = balance.reduce((s, b) => s + b.totalCents, 0);
  const currency = balance[0]?.currency ?? 'EUR';

  return (
    <section
      style={{
        background: NX.surface,
        border: `1px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: '14px 14px 12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: NX.featExpensesBg,
            color: NX.featExpenses,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PhIcon name="currencyDollar" size={15} />
        </div>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: NX.fg }}>Tu dois en tout</div>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: NX.featExpenses,
            background: NX.featExpensesBg,
            padding: '3px 10px',
            borderRadius: NX.radiusPill,
          }}
        >
          {formatMoney(grandTotalCents, currency)}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {balance.map((b) => (
          <div
            key={b.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 4px',
              fontSize: 13,
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: NX.elevated,
                color: NX.fgMuted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {b.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, color: NX.fg }}>
              à <span style={{ fontWeight: 600 }}>{b.name}</span>
            </div>
            <div style={{ fontSize: 11, color: NX.fgDim, marginRight: 8 }}>
              {b.count} dépense{b.count > 1 ? 's' : ''}
            </div>
            <div
              style={{
                fontWeight: 600,
                color: NX.featExpenses,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatMoney(b.totalCents, b.currency)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
