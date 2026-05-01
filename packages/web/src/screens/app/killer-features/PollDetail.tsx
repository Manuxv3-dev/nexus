import { useState } from 'react';

import { Avatar, PhIcon } from '@/components/ui';
import { usePolls } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { CopyLinkButton, FeatureHeader, PanelEmpty, PanelRoot } from './shared';

export function PollDetail({ groupId }: { groupId: string }) {
  const pollsQ = usePolls(groupId);
  const poll = pollsQ.data?.[0];
  const [myVote, setMyVote] = useState<string | null>(null);

  if (pollsQ.isLoading) return <PanelRoot><PanelEmpty title="Chargement…" /></PanelRoot>;
  if (!poll) {
    return (
      <PanelRoot>
        <FeatureHeader
          icon="chartBar"
          iconColor={NX.info}
          iconBg={NX.infoBg}
          title="Sondages"
          subtitle="Aucun sondage en cours"
        />
        <PanelEmpty
          title="Pas de sondage actif"
          hint='"Pizza ou sushi ?" — un sondage en 10 secondes.'
        />
      </PanelRoot>
    );
  }

  const totalVotes = poll.options.reduce(
    (s, o) => s + o.voters.length + (myVote === o.id ? 1 : 0),
    0,
  );

  return (
    <PanelRoot>
      <FeatureHeader
        icon="chartBar"
        iconColor={NX.info}
        iconBg={NX.infoBg}
        title={poll.question}
        subtitle={`${poll.multi ? 'Multi-choix' : 'Choix unique'} · ${totalVotes} votes`}
        action={<CopyLinkButton slug={poll.slug} kind="p" />}
      />

      <div
        style={{
          padding: '16px 20px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {poll.options.map((opt) => {
          const isVoted = myVote === opt.id;
          const votes = opt.voters.length + (isVoted ? 1 : 0);
          const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
          return (
            <button
              key={opt.id}
              onClick={() => setMyVote(isVoted ? null : opt.id)}
              style={{
                background: NX.elevated,
                borderRadius: NX.radiusSm,
                border: `1px solid ${isVoted ? `${NX.primary}44` : NX.border}`,
                padding: '12px 14px',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                transition: 'border-color 0.2s',
                textAlign: 'left',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  background: isVoted ? NX.primary : NX.fg,
                  opacity: isVoted ? 0.12 : 0.03,
                  borderRadius: NX.radiusSm,
                  transition: 'width 0.4s',
                }}
              />
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      border: `2px solid ${isVoted ? NX.primary : NX.borderHover}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isVoted ? NX.primary : 'transparent',
                      transition: 'all 0.2s',
                    }}
                  >
                    {isVoted && <PhIcon name="check" size={12} color="#fff" />}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: NX.fg }}>{opt.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', marginRight: 4 }}>
                    {opt.voters.slice(0, 3).map((v) => (
                      <Avatar key={v} name={v} size={20} />
                    ))}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isVoted ? NX.primary : NX.fgDim,
                      minWidth: 32,
                      textAlign: 'right',
                    }}
                  >
                    {pct}%
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: '12px 20px',
          borderTop: `1px solid ${NX.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <CopyLinkButton slug={poll.slug} kind="p" />
        {poll.closesAt && (
          <span style={{ fontSize: 11, color: NX.fgDim }}>
            Se ferme {new Date(poll.closesAt).toLocaleString('fr-FR')}
          </span>
        )}
      </div>
    </PanelRoot>
  );
}
