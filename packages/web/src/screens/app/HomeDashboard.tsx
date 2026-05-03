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
  useHomeFeed,
  type HomeAssignedTodoItem,
  type HomeGroupUnreadItem,
  type HomePendingRsvpItem,
  type HomeUnsettledExpenseItem,
  type HomeUpcomingEventItem,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

export type HomeNavTarget = {
  groupId: string;
  pane: 'chat' | 'event' | 'poll' | 'expense' | 'todo';
  sourceId?: string;
};

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
        background: NX.bg,
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
  const isAllEmpty =
    feed.pendingRsvps.length === 0 &&
    feed.unsettledExpenses.length === 0 &&
    feed.assignedTodos.length === 0 &&
    feed.upcomingEvents.length === 0 &&
    feed.unreadByGroup.length === 0;

  if (isAllEmpty) {
    return <HomeFullEmpty />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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

function RowButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
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
    <RowButton onClick={() => onNavigate({ groupId: item.groupId, pane: 'event', sourceId: item.id })}>
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
    <RowButton onClick={() => onNavigate({ groupId: item.groupId, pane: 'expense', sourceId: item.id })}>
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
    <RowButton onClick={() => onNavigate({ groupId: item.groupId, pane: 'todo', sourceId: item.id })}>
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
    <RowButton onClick={() => onNavigate({ groupId: item.groupId, pane: 'event', sourceId: item.id })}>
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

// ─────────────────────── Empty global state ─────────────────────

function HomeFullEmpty() {
  return (
    <div
      style={{
        padding: '60px 24px',
        textAlign: 'center',
        color: NX.fgDim,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: NX.elevated,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: NX.fgMuted,
        }}
      >
        <PhIcon name="check" size={28} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: NX.fg }}>Tu es à jour</div>
      <div style={{ fontSize: 13, maxWidth: 380, lineHeight: 1.6 }}>
        Pas de RSVP en attente, pas de dépense à régler, pas de tâche assignée. Profite-en pour
        ouvrir un sondage ou planifier le prochain apéro.
      </div>
    </div>
  );
}

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
