/**
 * Dashboard Polls — refonte structurelle (cf. ADR-021 + bundle HTML
 * 10-polls-dashboard.html, J5c).
 *
 * Layout interne au panel main de l'AppShell :
 *  - Main (1fr) : Hero "live poll" (poll le plus récent ouvert avec barres
 *    de vote en temps réel), Stats row, Grid de cards.
 *  - Right rail (340px ≥1280px) : activity feed (votes récents) + quick create.
 */
import { useEffect, useMemo, useState } from 'react';

import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { canManageGroupItem } from '@/lib/permissions';
import { useGroupMembers, useGroups, usePolls, type PollDto } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';
import { PollModal } from './polls/PollModal';

type Filter = 'open' | 'pending' | 'closed';

export function PollsDashboard({
  groupId,
  openCreate,
  onConsumeOpen,
}: {
  groupId?: string;
  /**
   * MAN-246 : intention de création émise par un CTA « Créer X » (HeroCard
   * vide de `GroupHomeDashboard`, QuickAction de `HomeDashboard`). Même canal
   * que `openItemId` — le shell la pose dans `pendingOpen`, le dashboard
   * l'ouvre au montage et la consomme via `onConsumeOpen`.
   */
  openCreate?: boolean | undefined;
  onConsumeOpen?: () => void;
} = {}) {
  const { user } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  // Fix 2026-05-05 : on respecte le groupe actif passé par AppShell.
  const activeGroupId = groupId ?? groups[0]?.id;
  // MAN-246 : le rôle du viewer dans ce groupe décide, avec l'auteur de
  // l'item, s'il peut le modifier ou le supprimer.
  const activeGroup = groups.find((g) => g.id === activeGroupId);

  const [filter, setFilter] = useState<Filter>('open');
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'view'; pollId: string } | null>(
    null,
  );

  // MAN-246 : ce dashboard ne reçoit PAS `openItemId` — contrairement aux trois
  // autres, `AppShell` ne lui a jamais câblé le deep-link vers un sondage
  // précis. Écart préexistant, hors périmètre de cette phase, suivi à part.
  useEffect(() => {
    if (openCreate) {
      setModal({ mode: 'create' });
      onConsumeOpen?.();
    }
  }, [openCreate, onConsumeOpen]);

  const openPollsQ = usePolls(activeGroupId, { state: 'open' });
  const closedPollsQ = usePolls(activeGroupId, { state: 'closed' });
  const openPolls = openPollsQ.data ?? [];
  const closedPolls = closedPollsQ.data ?? [];

  const allPolls = filter === 'closed' ? closedPolls : openPolls;
  const filteredPolls =
    filter === 'pending' && user
      ? allPolls.filter((p) => !p.options.some((o) => o.voters.includes(user.id)))
      : allPolls;

  const livePoll = openPolls[0];
  const openPoll =
    modal?.mode === 'view'
      ? openPolls.concat(closedPolls).find((p) => p.id === modal.pollId)
      : undefined;

  return (
    <FeatureShell
      iconName="chartBar"
      iconColor={NX.featPolls}
      iconBg={NX.featPollsBg}
      title="Sondages"
      subtitle={`${openPolls.length} ouverts · ${closedPolls.length} clos`}
      filters={
        <>
          <FilterChip
            label="Ouverts"
            active={filter === 'open'}
            onClick={() => setFilter('open')}
          />
          <FilterChip
            label="Mes votes en attente"
            active={filter === 'pending'}
            onClick={() => setFilter('pending')}
          />
          <FilterChip
            label="Clos"
            active={filter === 'closed'}
            onClick={() => setFilter('closed')}
          />
          <FilterDivider />
        </>
      }
    >
      {!activeGroupId ? (
        <Placeholder
          title="Aucun groupe actif"
          description="Sélectionne un groupe dans le rail de gauche."
        />
      ) : openPollsQ.isError ? (
        // MAN-244 : sans cette branche, un échec rendait l'état vide alors que
        // l'UI n'en savait rien.
        <div style={{ color: NX.error, padding: 24 }}>Impossible de charger les sondages.</div>
      ) : openPollsQ.isPending ? (
        // `isPending`, pas `isLoading` : query désactivée le temps que l'auth se
        // résolve, et en TanStack v5 une query désactivée rapporte
        // `isLoading === false` avec `isPending === true` (piège de MAN-231).
        <div style={{ color: NX.fgMuted, padding: 24 }}>Chargement…</div>
      ) : (
        <div style={dashLayout}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {livePoll && filter === 'open' ? (
              <LivePollHero
                poll={livePoll}
                userId={user?.id}
                onOpen={() => setModal({ mode: 'view', pollId: livePoll.id })}
              />
            ) : null}

            <PollsStatsRow open={openPolls} closed={closedPolls} userId={user?.id} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <SectionHeader
                title={
                  filter === 'closed'
                    ? 'Sondages clos'
                    : filter === 'pending'
                      ? 'À voter'
                      : 'Sondages ouverts'
                }
                count={filteredPolls.length}
              />
              {filteredPolls.length === 0 ? (
                <Placeholder
                  title={filter === 'closed' ? 'Pas de sondages clos' : 'Pas encore de sondages'}
                  description="Crée le premier avec « Nouveau sondage »."
                />
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 12,
                  }}
                >
                  {filteredPolls.map((p) => (
                    <PollCard
                      key={p.id}
                      poll={p}
                      userId={user?.id}
                      onOpen={() => setModal({ mode: 'view', pollId: p.id })}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT RAIL */}
          <div style={rightRailStyle}>
            <QuickCreate onCreate={() => activeGroupId && setModal({ mode: 'create' })} />
            <PollsActivityFeed
              polls={openPolls.concat(closedPolls)}
              userId={user?.id}
              groupId={activeGroupId}
            />
          </div>
        </div>
      )}

      {modal && activeGroupId ? (
        modal.mode === 'create' ? (
          <PollModal mode="create" groupId={activeGroupId} onClose={() => setModal(null)} />
        ) : openPoll ? (
          <PollModal
            mode="view"
            groupId={activeGroupId}
            poll={openPoll}
            canEdit={canManageGroupItem({
              userId: user?.id,
              authorId: openPoll.createdBy,
              role: activeGroup?.role,
            })}
            onClose={() => setModal(null)}
          />
        ) : null
      ) : null}
    </FeatureShell>
  );
}

// ─────────────────────────── Layout ────────────────────────────────────

const dashLayout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 340px',
  gap: 20,
  alignItems: 'start',
};

const rightRailStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  position: 'sticky',
  top: 16,
};

// ─────────────────────────── Hero (live poll) ───────────────────────────

function LivePollHero({
  poll,
  userId,
  onOpen,
}: {
  poll: PollDto;
  userId: string | undefined;
  onOpen: () => void;
}) {
  const totalVotes = poll.options.reduce((s, o) => s + o.voters.length, 0);
  const hasVoted = userId ? poll.options.some((o) => o.voters.includes(userId)) : false;
  const sortedOptions = [...poll.options].sort((a, b) => b.voters.length - a.voters.length);
  const closesAt = poll.closesAt ? new Date(poll.closesAt) : null;
  const closesIn = closesAt ? humanCloses(closesAt) : null;

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${NX.featPollsBg} 0%, transparent 80%), ${NX.surface}`,
        border: `0.5px solid ${NX.featPolls}33`,
        borderRadius: NX.radiusXl,
        padding: 24,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: NX.featPolls,
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: NX.featPolls,
            animation: 'pulse 2s ease-in-out infinite',
          }}
        />
        {closesIn ? `En direct · ${closesIn}` : 'En direct'}
      </div>

      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: NX.fg,
          margin: 0,
          marginBottom: 12,
          lineHeight: 1.2,
        }}
      >
        {poll.question}
      </h2>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: NX.fgMuted, marginBottom: 16 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <PhIcon name="checks" size={13} color={NX.fgMuted} />
          {totalVotes} {totalVotes > 1 ? 'votes' : 'vote'}
        </span>
        {poll.multi ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <PhIcon name="listChecks" size={13} color={NX.fgMuted} />
            Choix multiples
          </span>
        ) : null}
      </div>

      {/* Barres de vote (top 3 options) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {sortedOptions.slice(0, 3).map((opt) => {
          const pct = totalVotes === 0 ? 0 : Math.round((opt.voters.length / totalVotes) * 100);
          const myVote = userId ? opt.voters.includes(userId) : false;
          return (
            <div key={opt.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{ color: myVote ? NX.featPolls : NX.fg, fontWeight: myVote ? 600 : 500 }}
                >
                  {myVote ? '✓ ' : ''}
                  {opt.label}
                </span>
                <span style={{ color: NX.fgMuted, fontVariantNumeric: 'tabular-nums' }}>
                  {opt.voters.length} · {pct}%
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  background: NX.elevated,
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: NX.featPolls,
                    opacity: myVote ? 1 : 0.55,
                    transition: 'width 0.4s',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpen}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          background: hasVoted ? NX.elevated : NX.featPolls,
          color: hasVoted ? NX.fg : '#fff',
          border: hasVoted ? `0.5px solid ${NX.border}` : 'none',
          borderRadius: NX.radiusPill,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {hasVoted ? 'Voir les résultats' : 'Voter'}
        <PhIcon name="arrowRight" size={14} color={hasVoted ? NX.fg : '#fff'} />
      </button>
    </div>
  );
}

// ─────────────────────────── Stats ─────────────────────────────────────

function PollsStatsRow({
  open,
  closed,
  userId,
}: {
  open: PollDto[];
  closed: PollDto[];
  userId: string | undefined;
}) {
  const myPending = userId
    ? open.filter((p) => !p.options.some((o) => o.voters.includes(userId))).length
    : 0;
  const allPolls = open.concat(closed);
  const totalVotes = allPolls.reduce(
    (s, p) => s + p.options.reduce((a, o) => a + o.voters.length, 0),
    0,
  );
  const totalPossible = allPolls.length;
  const participation =
    totalPossible > 0 && allPolls.length > 0
      ? Math.round((totalVotes / Math.max(allPolls.length * 5, 1)) * 100)
      : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      <StatCard icon="chartBar" label="Ouverts" value={open.length.toString()} unit="polls" />
      <StatCard icon="hourglass" label="À voter (toi)" value={myPending.toString()} unit="" />
      <StatCard
        icon="checks"
        label="Participation"
        value={participation !== null ? participation.toString() : '—'}
        unit={participation !== null ? '%' : ''}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  unit,
}: {
  icon: 'chartBar' | 'hourglass' | 'checks';
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: NX.fgMuted,
          fontWeight: 500,
          marginBottom: 6,
        }}
      >
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {label}
      </div>
      <div
        style={{ fontSize: 22, fontWeight: 700, color: NX.fg, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
        <span style={{ fontSize: 11, color: NX.fgDim, fontWeight: 500, marginLeft: 4 }}>
          {unit}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────── Section header ────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
      <h3
        style={{ fontSize: 13, fontWeight: 600, color: NX.fg, margin: 0, letterSpacing: '-0.01em' }}
      >
        {title}
      </h3>
      <span style={{ fontSize: 11, color: NX.fgDim }}>{count}</span>
    </div>
  );
}

// ─────────────────────────── Right rail ────────────────────────────────

function PollsActivityFeed({
  polls,
  userId,
  groupId,
}: {
  polls: PollDto[];
  userId: string | undefined;
  groupId: string | undefined;
}) {
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];
  const nameById = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName])), [members]);

  const activity = useMemo(() => {
    const items: {
      pollId: string;
      pollQuestion: string;
      userId: string;
      optionLabel: string;
      date: string;
    }[] = [];
    for (const p of polls) {
      for (const opt of p.options) {
        for (const voterId of opt.voters) {
          items.push({
            pollId: p.id,
            pollQuestion: p.question,
            userId: voterId,
            optionLabel: opt.label,
            date: p.updatedAt,
          });
        }
      }
    }
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items.slice(0, 5);
  }, [polls]);

  const displayNameOf = (uid: string) =>
    uid === userId ? 'Toi' : (nameById.get(uid) ?? uid.slice(0, 6));

  return (
    <RailBlock icon="clock" title="Votes récents">
      {activity.length === 0 ? (
        <div style={{ fontSize: 12, color: NX.fgDim }}>Aucun vote.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activity.map((a, i) => {
            const name = displayNameOf(a.userId);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={name} size={22} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <span style={{ color: NX.fg, fontWeight: 500 }}>{name}</span>
                  <span style={{ color: NX.fgMuted }}>
                    {' '}
                    a voté{' '}
                    <span style={{ color: NX.featPolls, fontWeight: 500 }}>
                      « {a.optionLabel} »
                    </span>
                  </span>
                  <div
                    style={{
                      color: NX.fgDim,
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.pollQuestion}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </RailBlock>
  );
}

function QuickCreate({ onCreate }: { onCreate: () => void }) {
  return (
    <RailBlock icon="plusCircle" title="Créer rapidement">
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 12px',
          background: NX.featPollsBg,
          border: `0.5px dashed ${NX.featPolls}55`,
          borderRadius: NX.radiusMd,
          color: NX.featPolls,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <PhIcon name="plus" size={16} color={NX.featPolls} />
        Nouveau sondage
      </button>
      <div style={{ fontSize: 11, color: NX.fgGhost, marginTop: 8, lineHeight: 1.4 }}>
        Pizza ou sushi ? Plage ou montagne ? Tranche en 30s.
      </div>
    </RailBlock>
  );
}

function RailBlock({
  icon,
  title,
  children,
}: {
  icon: 'clock' | 'plusCircle';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: NX.fgMuted,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
        }}
      >
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {title}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────── Helpers ────────────────────────────────────

function humanCloses(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'clos';
  const hours = Math.floor(ms / (3600 * 1000));
  if (hours < 1) return `ferme dans ${Math.floor(ms / (60 * 1000))} min`;
  if (hours < 24)
    return `ferme dans ${hours}h ${Math.floor((ms % (3600 * 1000)) / (60 * 1000))} min`;
  const days = Math.floor(hours / 24);
  return `ferme dans ${days}j`;
}

// ─────────────────────────── Card ───────────────────────────────────────

function PollCard({
  poll,
  userId,
  onOpen,
}: {
  poll: PollDto;
  userId: string | undefined;
  onOpen: () => void;
}) {
  const totalVotes = poll.options.reduce((s, o) => s + o.voters.length, 0);
  const hasVoted = userId ? poll.options.some((o) => o.voters.includes(userId)) : false;
  const closed = poll.closesAt ? new Date(poll.closesAt).getTime() <= Date.now() : false;
  const top3 = [...poll.options].sort((a, b) => b.voters.length - a.voters.length).slice(0, 3);

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        background: NX.surface,
        border: `0.5px solid ${!hasVoted && !closed ? `${NX.featPolls}55` : NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
        textAlign: 'left',
        cursor: 'pointer',
        color: NX.fg,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{poll.question}</div>
        {!hasVoted && !closed ? (
          <span
            style={{
              fontSize: 10,
              padding: '2px 7px',
              background: NX.featPollsBg,
              color: NX.featPolls,
              borderRadius: NX.radiusPill,
              fontWeight: 600,
              flexShrink: 0,
              marginLeft: 8,
            }}
          >
            À voter
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 11, color: NX.fgDim, marginBottom: 10 }}>
        {totalVotes} vote{totalVotes > 1 ? 's' : ''}
        {poll.multi ? ' · multi' : ''}
        {closed ? ' · clos' : poll.closesAt ? ` · ${humanCloses(new Date(poll.closesAt))}` : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {top3.map((opt) => {
          const pct = totalVotes === 0 ? 0 : Math.round((opt.voters.length / totalVotes) * 100);
          const myVote = userId ? opt.voters.includes(userId) : false;
          return (
            <div key={opt.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  marginBottom: 2,
                }}
              >
                <span
                  style={{ color: myVote ? NX.featPolls : NX.fg, fontWeight: myVote ? 500 : 400 }}
                >
                  {opt.label}
                </span>
                <span style={{ color: NX.fgMuted }}>{pct}%</span>
              </div>
              <div style={{ height: 4, background: NX.elevated, borderRadius: 2 }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: NX.featPolls,
                    opacity: myVote ? 1 : 0.5,
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
          );
        })}
        {poll.options.length > 3 ? (
          <div style={{ fontSize: 10, color: NX.fgDim, marginTop: 2 }}>
            +{poll.options.length - 3} autre{poll.options.length - 3 > 1 ? 's' : ''}
          </div>
        ) : null}
      </div>
    </button>
  );
}
