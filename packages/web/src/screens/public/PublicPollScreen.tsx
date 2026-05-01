import { useParams } from '@tanstack/react-router';
import { useState } from 'react';

import { PhIcon } from '@/components/ui';
import { NX } from '@/lib/tokens';

import { OgMeta } from './og-meta';
import { PublicCTAFooter, PublicHero, PublicShell } from './PublicShell';
import { usePublicPoll } from './hooks';

export function PublicPollScreen() {
  const { slug } = useParams({ from: '/p/$slug' });
  const pollQ = usePublicPoll(slug);
  const [voted, setVoted] = useState<string | null>(null);

  if (pollQ.isLoading)
    return (
      <PublicShell>
        <div style={{ padding: 80, textAlign: 'center', color: NX.fgDim }}>Chargement…</div>
      </PublicShell>
    );
  if (!pollQ.data)
    return (
      <PublicShell>
        <div style={{ padding: 80, textAlign: 'center', color: NX.fg }}>Sondage introuvable</div>
      </PublicShell>
    );

  const poll = pollQ.data;
  const totalVotes = poll.options.reduce(
    (s, o) => s + o.voters.length + (voted === o.id ? 1 : 0),
    0,
  );

  return (
    <PublicShell>
      <OgMeta
        type="poll"
        slug={slug}
        title={poll.question}
        description={`${totalVotes} vote${totalVotes > 1 ? 's' : ''} · ${poll.options.length} options${poll.multi ? ' · multi-choix' : ''}`}
      />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 40px' }}>
        <PublicHero
          icon="chartBar"
          iconColor={NX.info}
          iconBg={NX.infoBg}
          type="Sondage"
          groupName="Groupe Nexus"
          title={poll.question}
          gradientFrom="rgba(96,165,250,0.12)"
          gradientTo="rgba(124,92,252,0.08)"
          meta={`${poll.multi ? 'Multi-choix' : 'Choix unique'} · ${totalVotes} votes${
            poll.closesAt ? ` · Se ferme le ${new Date(poll.closesAt).toLocaleString('fr-FR')}` : ''
          }`}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {poll.options.map((opt) => {
            const isVoted = voted === opt.id;
            const v = opt.voters.length + (isVoted ? 1 : 0);
            const pct = totalVotes > 0 ? Math.round((v / totalVotes) * 100) : 0;
            return (
              <button
                key={opt.id}
                onClick={() => setVoted(isVoted ? null : opt.id)}
                style={{
                  padding: '14px 16px',
                  borderRadius: NX.radiusSm,
                  cursor: 'pointer',
                  background: NX.elevated,
                  border: `1px solid ${isVoted ? `${NX.primary}44` : NX.border}`,
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
                    opacity: isVoted ? 0.12 : 0.04,
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
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        border: `2px solid ${isVoted ? NX.primary : NX.borderHover}`,
                        background: isVoted ? NX.primary : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                      }}
                    >
                      {isVoted && <PhIcon name="check" size={12} color="#fff" />}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: NX.fg }}>{opt.label}</span>
                  </div>
                  <span
                    style={{ fontSize: 14, fontWeight: 600, color: isVoted ? NX.primary : NX.fgDim }}
                  >
                    {pct}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {!voted && <PublicCTAFooter />}
      </div>
    </PublicShell>
  );
}
