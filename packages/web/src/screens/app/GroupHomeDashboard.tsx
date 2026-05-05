/**
 * GroupHomeDashboard — vue d'accueil par groupe (cf. polish post-ADR-027 P7+P8).
 *
 * Rendu dans la zone main de AppShell quand `pane === 'group_home'`. Mirror
 * du `HomeDashboard` mais scopé au groupe actif au lieu d'agréger
 * cross-groupes.
 *
 * Layout (P8 densification) :
 *   ┌──── Header : nom du groupe + memberCount + GroupMenu ────┐
 *   ├──── Grid 2-col de 4 Hero cards features ─────────────────┤
 *   │  EventsHero       │ PollsHero                              │
 *   │  ExpensesHero     │ TodosHero                              │
 *
 * Chaque Hero affiche un KPI principal + un teaser du prochain item d'action,
 * cliquable pour basculer sur le dashboard complet du feature. Pas de
 * doublon avec les dashboards eux-mêmes : ici c'est un coup d'œil dense, là
 * c'est l'expérience complète.
 *
 * Note design : les Hero des dashboards (NextEventHero, LivePollHero, etc.)
 * sont volontairement dupliqués en version compacte ici. Empiler 4 Hero
 * « pleine taille » serait écrasant. La version compacte garde la même
 * signature visuelle (gradient feature, border accent, icône, CTA flottant).
 */
import { useMemo } from 'react';

import { Avatar, PhIcon, type PhIconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useEvents,
  useExpenses,
  useGroupMembers,
  usePolls,
  useTodoLists,
  type EventDto,
  type ExpenseDto,
  type Group,
  type PollDto,
  type TodoListDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { ActivityTimeline } from './ActivityTimeline';
import { GroupMenu } from './GroupMenu';
import { WeekCalendar } from './WeekCalendar';

// M1+M6 (post-ADR-027) : les sessions messageries ne sont plus scopées au
// groupe (elles sont user-scoped). Donc plus de section "Conversations
// connectées" ici. La nav reste vers les 4 panes feature du groupe.
export interface GroupHomeNavTarget {
  pane: 'event' | 'poll' | 'expense' | 'todo';
  sourceId?: string;
}

interface GroupHomeDashboardProps {
  group: Group;
  onNavigate: (target: GroupHomeNavTarget) => void;
}

export function GroupHomeDashboard({ group, onNavigate }: GroupHomeDashboardProps) {
  const user = useAuth((s) => s.user);
  const userId = user?.id ?? null;

  const eventsQ = useEvents(group.id, { when: 'upcoming' });
  const pollsQ = usePolls(group.id, { state: 'open' });
  const expensesQ = useExpenses(group.id, { state: 'open' });
  const todosQ = useTodoLists(group.id);
  const membersQ = useGroupMembers(group.id);

  const memberCount = membersQ.data?.length ?? 0;

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
      {/* === Header groupe === */}
      <header
        style={{
          padding: `${NX.spaceDashboard}px ${NX.spaceDashboardLg}px ${NX.spaceDashboard - 4}px`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          borderBottom: `0.5px solid ${NX.border}`,
        }}
      >
        <Avatar name={group.name} size={40} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {group.name}
          </div>
          <div style={{ fontSize: 12, color: NX.fgMuted, marginTop: 2 }}>
            {memberCount} membre{memberCount > 1 ? 's' : ''}
          </div>
        </div>
        <GroupMenu group={group} />
      </header>

      {/* === Body : 4 Hero cards + WeekCalendar + ActivityTimeline === */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: `${NX.spaceDashboard}px ${NX.spaceDashboardLg}px ${NX.spaceDashboardLg}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
            gap: 16,
          }}
        >
          <EventsHero
            events={eventsQ.data ?? []}
            isLoading={eventsQ.isLoading}
            onOpen={(sourceId) => onNavigate({ pane: 'event', ...(sourceId ? { sourceId } : {}) })}
          />
          <PollsHero
            polls={pollsQ.data ?? []}
            userId={userId}
            isLoading={pollsQ.isLoading}
            onOpen={(sourceId) => onNavigate({ pane: 'poll', ...(sourceId ? { sourceId } : {}) })}
          />
          <ExpensesHero
            expenses={expensesQ.data ?? []}
            userId={userId}
            isLoading={expensesQ.isLoading}
            onOpen={(sourceId) => onNavigate({ pane: 'expense', ...(sourceId ? { sourceId } : {}) })}
          />
          <TodosHero
            lists={todosQ.data ?? []}
            userId={userId}
            isLoading={todosQ.isLoading}
            onOpen={(sourceId) => onNavigate({ pane: 'todo', ...(sourceId ? { sourceId } : {}) })}
          />
        </div>

        {/* Mirror du HomeDashboard (post-2026-05-05) : calendrier semaine
            scopé aux events du groupe + timeline d'activité scopée. Cohérence
            visuelle avec la home cross-groupes. */}
        <WeekCalendar
          events={eventsQ.data ?? []}
          onEventClick={(e) => onNavigate({ pane: 'event', sourceId: e.id })}
        />

        <GroupActivitySection groupId={group.id} onNavigate={onNavigate} />
      </main>
    </div>
  );
}

/**
 * Section "Activité récente" scopée au groupe courant. Wrappe ActivityTimeline
 * dans une section style-Card sans chip groupe (le contexte est déjà clair).
 */
function GroupActivitySection({
  groupId,
  onNavigate,
}: {
  groupId: string;
  onNavigate: (target: GroupHomeNavTarget) => void;
}) {
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
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: NX.fg }}>
          Activité récente
        </div>
      </header>
      <ActivityTimeline
        groupId={groupId}
        onNavigate={(t) => {
          // ActivityNavTarget → GroupHomeNavTarget. La pane 'chat' n'a pas
          // d'équivalent dans GroupHomeNavTarget (qui ne gère que les 4
          // features), donc on filtre.
          if (t.pane === 'chat') return;
          onNavigate({
            pane: t.pane,
            ...(t.sourceId !== undefined ? { sourceId: t.sourceId } : {}),
          });
        }}
      />
    </section>
  );
}

// ─────────────────────── Hero compacts par feature ──────────────────────

function HeroCard({
  icon,
  iconColor,
  iconBg,
  accent,
  accentSoftBg,
  label,
  kpiValue,
  kpiUnit,
  teaserTitle,
  teaserMeta,
  ctaLabel,
  onOpen,
  onTeaserClick,
}: {
  icon: PhIconName;
  iconColor: string;
  iconBg: string;
  accent: string;
  accentSoftBg: string;
  label: string;
  kpiValue: string;
  kpiUnit?: string | undefined;
  teaserTitle?: string | undefined;
  teaserMeta?: string | undefined;
  ctaLabel: string;
  onOpen: () => void;
  onTeaserClick?: (() => void) | undefined;
}) {
  return (
    <section
      style={{
        background: `linear-gradient(135deg, ${accentSoftBg} 0%, transparent 70%), ${NX.surface}`,
        border: `0.5px solid ${accent}33`,
        borderRadius: NX.radiusXl,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        minHeight: 180,
      }}
    >
      {/* Header : icône + label */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: iconBg,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PhIcon name={icon} size={17} />
        </div>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: accent,
            fontWeight: 600,
          }}
        >
          {label}
        </div>
      </header>

      {/* KPI principal */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: NX.fg,
            lineHeight: 1,
          }}
        >
          {kpiValue}
        </span>
        {kpiUnit ? (
          <span style={{ fontSize: 13, color: NX.fgMuted, fontWeight: 500 }}>{kpiUnit}</span>
        ) : null}
      </div>

      {/* Teaser (optionnel) — clique vers l'item précis */}
      {teaserTitle ? (
        <button
          type="button"
          onClick={onTeaserClick ?? onOpen}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 2,
            padding: '8px 10px',
            background: NX.elevated,
            border: `0.5px solid ${NX.border}`,
            borderRadius: NX.radiusSm,
            cursor: 'pointer',
            color: 'inherit',
            textAlign: 'left',
            transition: 'border-color 120ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = NX.border;
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: NX.fg,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}
          >
            {teaserTitle}
          </span>
          {teaserMeta ? (
            <span style={{ fontSize: 11, color: NX.fgDim }}>{teaserMeta}</span>
          ) : null}
        </button>
      ) : null}

      {/* CTA */}
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onOpen}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          background: accent,
          color: '#fff',
          border: 'none',
          borderRadius: NX.radiusPill,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {ctaLabel}
        <PhIcon name="arrowRight" size={13} color="#fff" />
      </button>
    </section>
  );
}

function EventsHero({
  events,
  isLoading,
  onOpen,
}: {
  events: EventDto[];
  isLoading: boolean;
  onOpen: (sourceId?: string) => void;
}) {
  const upcoming = useMemo(
    () =>
      events
        .filter((e) => new Date(e.startsAt).getTime() >= Date.now())
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [events],
  );
  const next = upcoming[0];
  const count = upcoming.length;

  return (
    <HeroCard
      icon="calendarBlank"
      iconColor={NX.featEvents}
      iconBg={NX.featEventsBg}
      accent={NX.featEvents}
      accentSoftBg={NX.featEventsBg}
      label="Événements"
      kpiValue={isLoading ? '…' : String(count)}
      kpiUnit={count === 0 ? 'à venir' : count > 1 ? 'à venir' : 'à venir'}
      teaserTitle={next?.title}
      teaserMeta={
        next
          ? formatRelativeDate(next.startsAt) + (next.location ? ` · ${next.location}` : '')
          : undefined
      }
      ctaLabel={count === 0 ? 'Créer un événement' : "Voir l'agenda"}
      onOpen={() => onOpen()}
      onTeaserClick={next ? () => onOpen(next.id) : undefined}
    />
  );
}

function PollsHero({
  polls,
  userId,
  isLoading,
  onOpen,
}: {
  polls: PollDto[];
  userId: string | null;
  isLoading: boolean;
  onOpen: (sourceId?: string) => void;
}) {
  const pendingForMe = useMemo(() => {
    if (!userId) return polls;
    return polls.filter((p) => !p.options.some((o) => o.voters.includes(userId)));
  }, [polls, userId]);
  const next = pendingForMe[0];

  return (
    <HeroCard
      icon="chartBar"
      iconColor={NX.featPolls}
      iconBg={NX.featPollsBg}
      accent={NX.featPolls}
      accentSoftBg={NX.featPollsBg}
      label="Sondages"
      kpiValue={isLoading ? '…' : String(pendingForMe.length)}
      kpiUnit={
        pendingForMe.length === 0 ? 'en attente de toi' : 'en attente de toi'
      }
      teaserTitle={next?.question}
      teaserMeta={
        next
          ? `${next.options.length} options${next.closesAt ? ` · ferme ${formatRelativeDate(next.closesAt)}` : ''}`
          : undefined
      }
      ctaLabel={pendingForMe.length === 0 ? 'Lancer un sondage' : 'Voir les sondages'}
      onOpen={() => onOpen()}
      onTeaserClick={next ? () => onOpen(next.id) : undefined}
    />
  );
}

function ExpensesHero({
  expenses,
  userId,
  isLoading,
  onOpen,
}: {
  expenses: ExpenseDto[];
  userId: string | null;
  isLoading: boolean;
  onOpen: (sourceId?: string) => void;
}) {
  // Solde net : ∑(montants payés par moi non réglés par les autres)
  //          − ∑(parts non réglées que je dois)
  // Si > 0 : on me doit. Si < 0 : je dois. Si 0 : équilibre.
  const { netCents, currency, myOpenCount, nextOpen } = useMemo(() => {
    let net = 0;
    let curr = 'EUR';
    let count = 0;
    let firstOpen: ExpenseDto | undefined;
    for (const e of expenses) {
      if (e.settledAt) continue;
      curr = e.currency;
      // Mes parts non réglées que je dois
      if (userId) {
        const myShare = e.shares.find((s) => s.userId === userId && !s.isSettled);
        if (myShare) {
          count += 1;
          firstOpen ??= e;
          // Si c'est moi qui ai payé, mes parts à moi-même sont gratuites
          if (e.paidBy !== userId) net -= myShare.shareCents;
        }
        // Parts dues par les autres si c'est moi qui ai payé
        if (e.paidBy === userId) {
          for (const s of e.shares) {
            if (s.userId === userId) continue;
            if (!s.isSettled) net += s.shareCents;
          }
        }
      }
    }
    return { netCents: net, currency: curr, myOpenCount: count, nextOpen: firstOpen };
  }, [expenses, userId]);

  const isPositive = netCents > 0;
  const absLabel = formatMoney(Math.abs(netCents), currency);
  const kpiValue = isLoading
    ? '…'
    : netCents === 0
      ? formatMoney(0, currency)
      : (isPositive ? '+' : '−') + absLabel;
  const kpiUnit = netCents === 0 ? 'tout est réglé' : isPositive ? 'on te doit' : 'tu dois';

  return (
    <HeroCard
      icon="currencyDollar"
      iconColor={NX.featExpenses}
      iconBg={NX.featExpensesBg}
      accent={NX.featExpenses}
      accentSoftBg={NX.featExpensesBg}
      label="Dépenses"
      kpiValue={kpiValue}
      kpiUnit={kpiUnit}
      teaserTitle={
        myOpenCount > 0
          ? nextOpen?.description
          : isPositive
            ? 'Réclame ton dû ou marque comme réglé'
            : undefined
      }
      teaserMeta={
        myOpenCount > 0
          ? `${myOpenCount} dépense${myOpenCount > 1 ? 's' : ''} ouverte${myOpenCount > 1 ? 's' : ''}`
          : undefined
      }
      ctaLabel={myOpenCount === 0 && netCents === 0 ? 'Ajouter une dépense' : 'Voir les soldes'}
      onOpen={() => onOpen()}
      onTeaserClick={nextOpen ? () => onOpen(nextOpen.id) : undefined}
    />
  );
}

function TodosHero({
  lists,
  userId,
  isLoading,
  onOpen,
}: {
  lists: TodoListDto[];
  userId: string | null;
  isLoading: boolean;
  onOpen: (sourceId?: string) => void;
}) {
  const { myOpenCount, nextItem, nextListTitle } = useMemo(() => {
    if (!userId)
      return {
        myOpenCount: 0,
        nextItem: undefined as TodoListDto['items'][number] | undefined,
        nextListTitle: undefined as string | undefined,
      };
    let count = 0;
    let firstItem: TodoListDto['items'][number] | undefined;
    let firstListTitle: string | undefined;
    for (const list of lists) {
      for (const item of list.items) {
        if (item.done) continue;
        if (item.assigneeId !== userId) continue;
        count += 1;
        if (!firstItem) {
          firstItem = item;
          firstListTitle = list.title;
        }
      }
    }
    return { myOpenCount: count, nextItem: firstItem, nextListTitle: firstListTitle };
  }, [lists, userId]);

  return (
    <HeroCard
      icon="listChecks"
      iconColor={NX.featTodo}
      iconBg={NX.featTodoBg}
      accent={NX.featTodo}
      accentSoftBg={NX.featTodoBg}
      label="Mes tâches"
      kpiValue={isLoading ? '…' : String(myOpenCount)}
      kpiUnit={myOpenCount === 0 ? 'tout est fait' : 'à faire'}
      teaserTitle={nextItem?.text}
      teaserMeta={nextListTitle}
      ctaLabel={lists.length === 0 ? 'Créer une liste' : 'Voir mes tâches'}
      onOpen={() => onOpen()}
      onTeaserClick={nextItem ? () => onOpen(nextItem.id) : undefined}
    />
  );
}

// ─────────────────────── Format helpers ─────────────────────────

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.round((d.getTime() - now) / 60_000);
  const abs = Math.abs(diffMin);
  if (abs < 60) {
    return diffMin >= 0 ? `dans ${abs} min` : `il y a ${abs} min`;
  }
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24) {
    return diffH >= 0 ? `dans ${diffH} h` : `il y a ${Math.abs(diffH)} h`;
  }
  const diffD = Math.round(diffH / 24);
  if (Math.abs(diffD) < 7) {
    return diffD >= 0 ? `dans ${diffD} j` : `il y a ${Math.abs(diffD)} j`;
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
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
