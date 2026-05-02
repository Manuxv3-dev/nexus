/**
 * Dashboard Polls — vue panel pour `pane === 'poll'`. Cf. J5b #39.
 */
import { useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useGroups, usePolls, type PollDto } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';
import { PollModal } from './polls/PollModal';

type Filter = 'open' | 'pending' | 'closed';

export function PollsDashboard() {
  const { user } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  const activeGroupId = groups[0]?.id;

  const [filter, setFilter] = useState<Filter>('open');
  // Stocker l'ID seulement pour que la modal suive les re-fetch après vote.
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'view'; pollId: string } | null
  >(null);

  const pollsQ = usePolls(activeGroupId, {
    state: filter === 'closed' ? 'closed' : 'open',
  });
  const allPolls = pollsQ.data ?? [];
  const openPoll = modal?.mode === 'view' ? allPolls.find((p) => p.id === modal.pollId) : undefined;

  const filteredPolls =
    filter === 'pending' && user
      ? allPolls.filter((p) => !p.options.some((o) => o.voters.includes(user.id)))
      : allPolls;

  return (
    <FeatureShell
      iconName="chartBar"
      iconColor={NX.info}
      iconBg={NX.infoBg}
      title="Sondages"
      subtitle={`${allPolls.length} ${filter === 'closed' ? 'clos' : 'ouverts'}`}
      primaryAction={{
        label: 'Nouveau sondage',
        onClick: () => activeGroupId && setModal({ mode: 'create' }),
      }}
      filters={
        <>
          <FilterChip label="Ouverts" active={filter === 'open'} onClick={() => setFilter('open')} />
          <FilterChip
            label="Mes votes en attente"
            active={filter === 'pending'}
            onClick={() => setFilter('pending')}
          />
          <FilterChip label="Clos" active={filter === 'closed'} onClick={() => setFilter('closed')} />
          <FilterDivider />
        </>
      }
    >
      {!activeGroupId ? (
        <Placeholder
          title="Aucun groupe actif"
          description="Sélectionne un groupe dans le rail de gauche."
        />
      ) : pollsQ.isLoading ? (
        <div style={{ color: NX.fgMuted, padding: 24 }}>Chargement…</div>
      ) : filteredPolls.length === 0 ? (
        <Placeholder
          title={filter === 'closed' ? 'Pas de sondages clos' : 'Pas encore de sondages'}
          description="Crée le premier avec le bouton « Nouveau sondage »."
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
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

      {modal && activeGroupId ? (
        modal.mode === 'create' ? (
          <PollModal
            mode="create"
            groupId={activeGroupId}
            onClose={() => setModal(null)}
          />
        ) : openPoll ? (
          <PollModal
            mode="view"
            groupId={activeGroupId}
            poll={openPoll}
            canEdit={user ? openPoll.createdBy === user.id : false}
            onClose={() => setModal(null)}
          />
        ) : null
      ) : null}
    </FeatureShell>
  );
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
  const top3 = poll.options.slice(0, 3);

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        background: NX.surface,
        border: `0.5px solid ${!hasVoted && !closed ? NX.warning : NX.border}`,
        borderRadius: NX.radius,
        padding: 14,
        textAlign: 'left',
        cursor: 'pointer',
        color: NX.fg,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{poll.question}</div>
        {!hasVoted && !closed ? (
          <span style={{ fontSize: 10, color: NX.warning, flexShrink: 0, marginLeft: 8 }}>À voter</span>
        ) : null}
      </div>
      <div style={{ fontSize: 11, color: NX.fgDim, marginBottom: 10 }}>
        {totalVotes} vote{totalVotes > 1 ? 's' : ''}
        {poll.multi ? ' · multi' : ''}
        {closed ? ' · clos' : poll.closesAt ? ` · clôture ${new Date(poll.closesAt).toLocaleDateString('fr-FR')}` : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {top3.map((opt) => {
          const pct = totalVotes === 0 ? 0 : Math.round((opt.voters.length / totalVotes) * 100);
          const myVote = userId ? opt.voters.includes(userId) : false;
          return (
            <div key={opt.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                <span style={{ color: myVote ? NX.info : NX.fg, fontWeight: myVote ? 500 : 400 }}>
                  {opt.label}
                </span>
                <span style={{ color: NX.fgMuted }}>{pct}%</span>
              </div>
              <div style={{ height: 4, background: NX.elevated, borderRadius: 2 }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: NX.info,
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
