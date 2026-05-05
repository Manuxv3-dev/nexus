/**
 * ActivityTimeline — composant réutilisable pour HomeDashboard et
 * GroupHomeDashboard (cf. ADR-029).
 *
 * Affiche la timeline d'activité (qui a fait quoi récemment) :
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ [avatar M]  Manu a créé l'event « Brunch dimanche »         │
 *   │             il y a 2h · Les potes                          │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ [avatar J]  Julie a voté « Pizza » dans « Quel resto ? »   │
 *   │             il y a 3h · Les potes                          │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Click sur une ligne → deep-link vers la feature concernée (event/poll/...)
 * via le callback `onNavigate` (le parent gère le routage interne AppShell).
 *
 * `groupId` optionnel : si fourni, filtre la timeline (utilisé par
 * GroupHomeDashboard) ; sinon timeline cross-groupes (Home Nexus).
 *
 * Pagination "Charger plus" via fetchNextPage du useInfiniteQuery.
 */
import { Avatar, PhIcon, type PhIconName } from '@/components/ui';
import {
  useActivityFeed,
  type ActivityItemDto,
  type ActivityKind,
  type ActivityTargetType,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

export interface ActivityNavTarget {
  groupId: string;
  pane: 'event' | 'poll' | 'expense' | 'todo' | 'chat';
  sourceId?: string;
}

interface ActivityTimelineProps {
  /** Si fourni, filtre la timeline sur ce groupe. Sinon cross-groupes. */
  groupId?: string;
  /** Callback de navigation deep-link vers la feature concernée. */
  onNavigate: (target: ActivityNavTarget) => void;
  /** Affiche le chip groupe à droite de chaque ligne (Home only). */
  showGroupChip?: boolean;
  /** Limite l'affichage à N premières pages (default 1). "Charger plus" charge les pages suivantes. */
  initialPageLimit?: number;
}

export function ActivityTimeline({
  groupId,
  onNavigate,
  showGroupChip,
  initialPageLimit = 1,
}: ActivityTimelineProps) {
  // Spread conditionnel : sous `exactOptionalPropertyTypes`, passer
  // `groupId: undefined` est interdit. On ne l'inclut que s'il est défini.
  const q = useActivityFeed(groupId !== undefined ? { groupId } : {});

  if (q.isLoading) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center', color: NX.fgDim, fontSize: 13 }}>
        Chargement…
      </div>
    );
  }

  if (q.isError) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center', color: NX.error, fontSize: 13 }}>
        Impossible de charger l'activité.
      </div>
    );
  }

  const allItems: ActivityItemDto[] = (q.data?.pages ?? []).flatMap((p) => p.items);

  if (allItems.length === 0) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center', color: NX.fgDim, fontSize: 13 }}>
        Pas encore d'activité.
      </div>
    );
  }

  // Limite côté UI : au premier rendu on affiche `initialPageLimit` pages,
  // puis "Charger plus" déclenche fetchNextPage. Si l'user a déjà cliqué sur
  // "Charger plus", q.data.pages.length augmente et on affiche tout.
  const pages = q.data?.pages ?? [];
  const visiblePages = pages.slice(0, Math.max(initialPageLimit, pages.length));
  const visibleItems = visiblePages.flatMap((p) => p.items);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {visibleItems.map((it) => (
        <ActivityRow
          key={it.id}
          item={it}
          onNavigate={onNavigate}
          showGroupChip={!!showGroupChip}
        />
      ))}
      {q.hasNextPage ? (
        <button
          type="button"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: NX.elevated,
            border: `1px solid ${NX.border}`,
            borderRadius: NX.radiusSm,
            cursor: q.isFetchingNextPage ? 'wait' : 'pointer',
            color: NX.fgMuted,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {q.isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
        </button>
      ) : null}
    </div>
  );
}

// ─────────────────────────── Row ────────────────────────────────────────

function ActivityRow({
  item,
  onNavigate,
  showGroupChip,
}: {
  item: ActivityItemDto;
  onNavigate: (target: ActivityNavTarget) => void;
  showGroupChip: boolean;
}) {
  const text = formatActivityText(item);
  const icon = iconForKind(item.kind);
  const color = colorForKind(item.kind);
  const actorName = item.payload.actorName ?? 'Quelqu\'un';
  const target = navTargetFor(item);

  return (
    <button
      type="button"
      onClick={() => target && onNavigate(target)}
      disabled={!target}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 6px',
        background: 'transparent',
        border: 'none',
        cursor: target ? 'pointer' : 'default',
        borderRadius: NX.radiusSm,
        textAlign: 'left',
        color: 'inherit',
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => {
        if (target) e.currentTarget.style.background = NX.elevated;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <Avatar name={actorName} size={24} />
      <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
        <div
          style={{
            fontSize: 13,
            color: NX.fg,
            lineHeight: 1.35,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <PhIcon name={icon} size={12} color={color} />
          <span style={{ flex: 1 }}>{text}</span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: NX.fgDim,
            marginTop: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>{formatRelativeTime(item.createdAt)}</span>
          {showGroupChip ? (
            <>
              <span>·</span>
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: NX.radiusPill,
                  background: NX.elevated,
                  color: NX.fgDim,
                  fontWeight: 600,
                  fontSize: 10,
                }}
              >
                {item.groupName}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────── Mapping kind → texte (fr) ──────────────────

function formatActivityText(item: ActivityItemDto): string {
  const actor = item.payload.actorName ?? 'Quelqu\'un';
  const target = item.payload.targetTitle ?? '';
  const p = item.payload;

  switch (item.kind) {
    case 'event:created':
      return `${actor} a créé l'event « ${target} »`;
    case 'event:rsvp:changed': {
      const rsvp = p.rsvp ?? '';
      const rsvpFr = rsvp === 'yes' ? 'oui' : rsvp === 'no' ? 'non' : rsvp === 'maybe' ? 'peut-être' : rsvp;
      return `${actor} a répondu ${rsvpFr} à « ${target} »`;
    }
    case 'event:cancelled':
      return `${actor} a annulé l'event « ${target} »`;
    case 'poll:created':
      return `${actor} a lancé le sondage « ${target} »`;
    case 'poll:voted':
      return `${actor} a voté « ${p.optionLabel ?? ''} » dans « ${target} »`;
    case 'poll:closed':
      return `Le sondage « ${target} » est clos`;
    case 'expense:added': {
      const amount = formatMoneyCents(p.amountCents, p.currency);
      return `${actor} a ajouté la dépense « ${target} »${amount ? ` (${amount})` : ''}`;
    }
    case 'expense:settled':
      return `${actor} a réglé sa part de « ${target} »`;
    case 'todo_list:created':
      return `${actor} a créé la liste « ${target} »`;
    case 'todo_item:checked':
      return `${actor} a coché « ${p.itemText ?? ''} »`;
    case 'todo_item:assigned': {
      const ass = p.assigneeName ? ` à ${p.assigneeName}` : '';
      return `${actor} a assigné « ${p.itemText ?? ''} »${ass}`;
    }
    case 'member:joined':
      return `${actor} a rejoint le groupe`;
    case 'member:left':
      return `${actor} a quitté le groupe`;
    default:
      return `${actor} : ${item.kind}`;
  }
}

function iconForKind(kind: ActivityKind): PhIconName {
  switch (kind) {
    case 'event:created':
    case 'event:rsvp:changed':
    case 'event:cancelled':
      return 'calendarBlank';
    case 'poll:created':
    case 'poll:voted':
    case 'poll:closed':
      return 'chartBar';
    case 'expense:added':
    case 'expense:settled':
      return 'currencyDollar';
    case 'todo_list:created':
    case 'todo_item:checked':
    case 'todo_item:assigned':
      return 'listChecks';
    case 'member:joined':
    case 'member:left':
      return 'users';
    default:
      return 'bell';
  }
}

function colorForKind(kind: ActivityKind): string {
  switch (kind) {
    case 'event:created':
    case 'event:rsvp:changed':
    case 'event:cancelled':
      return NX.featEvents;
    case 'poll:created':
    case 'poll:voted':
    case 'poll:closed':
      return NX.featPolls;
    case 'expense:added':
    case 'expense:settled':
      return NX.featExpenses;
    case 'todo_list:created':
    case 'todo_item:checked':
    case 'todo_item:assigned':
      return NX.featTodo;
    case 'member:joined':
    case 'member:left':
      return NX.fgMuted;
    default:
      return NX.fgMuted;
  }
}

function navTargetFor(item: ActivityItemDto): ActivityNavTarget | null {
  if (!item.targetId) return null;
  const map: Record<ActivityTargetType, ActivityNavTarget['pane'] | null> = {
    event: 'event',
    poll: 'poll',
    expense: 'expense',
    todo_list: 'todo',
    todo_item: 'todo',
    member: null,
  };
  const pane = map[item.targetType];
  if (!pane) return null;
  return { groupId: item.groupId, pane, sourceId: item.targetId };
}

// ─────────────────────────── Format helpers ─────────────────────────────

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'à l\'instant';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `il y a ${diffD} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatMoneyCents(cents: number | undefined, currency: string | undefined): string {
  if (cents === undefined) return '';
  const cur = currency ?? 'EUR';
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
}
