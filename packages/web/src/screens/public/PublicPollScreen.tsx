/**
 * Page publique sondage `/p/:slug`.
 *
 * Comportement (cf. J5b #39 + #51 sync) :
 *  - Lecture publique : tout le monde voit les résultats live (mise à jour
 *    via WS dès qu'un membre vote — cf. useKillerFeaturesWs au router).
 *  - Vote interactif : si l'utilisateur est connecté ET membre du groupe
 *    propriétaire du sondage, le clic enregistre vraiment via `useVote`
 *    (mutation backend → WS → invalidate partout). Sinon le bouton
 *    redirige vers /login.
 */
import { useParams } from '@tanstack/react-router';

import { PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useGroups, useVote } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { OgMeta } from './og-meta';
import { PublicCTAFooter, PublicHero, PublicShell } from './PublicShell';
import { usePublicPoll } from './hooks';

export function PublicPollScreen() {
  const { slug } = useParams({ from: '/p/$slug' });
  const pollQ = usePublicPoll(slug);
  const user = useAuth((s) => s.user);
  const authInitializing = useAuth((s) => s.initializing);
  const groupsQ = useGroups();
  const vote = useVote();

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
  // Tant que l'auth s'initialise / que les groupes chargent, on ne sait
  // pas si l'utilisateur est membre — on évite d'afficher un CTA erroné
  // (cf. fix Bug #57 page publique pas auth recognized).
  const authReady = !authInitializing;
  const membershipResolved = authReady && (!user || groupsQ.isSuccess);
  const groups = groupsQ.data ?? [];
  const isMember = !!user && groups.some((g) => g.id === poll.groupId);
  const closed = poll.closesAt ? new Date(poll.closesAt).getTime() <= Date.now() : false;
  const canVote = isMember && !closed;
  const totalVotes = poll.options.reduce((s, o) => s + o.voters.length, 0);

  const handleVote = (optionId: string, currentlyVoted: boolean) => {
    if (!canVote) return;
    void vote.mutateAsync({ pollId: poll.id, optionId, value: !currentlyVoted });
  };

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
            poll.closesAt
              ? closed
                ? ' · clos'
                : ` · clôture ${new Date(poll.closesAt).toLocaleString('fr-FR')}`
              : ''
          }`}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {poll.options.map((opt) => {
            const isVoted = user ? opt.voters.includes(user.id) : false;
            const pct = totalVotes > 0 ? Math.round((opt.voters.length / totalVotes) * 100) : 0;
            return (
              <button
                key={opt.id}
                onClick={() => handleVote(opt.id, isVoted)}
                disabled={!canVote || vote.isPending === true || !membershipResolved}
                style={{
                  padding: '14px 16px',
                  borderRadius: NX.radiusSm,
                  cursor: canVote ? 'pointer' : 'default',
                  background: NX.elevated,
                  border: `1px solid ${isVoted ? `${NX.primary}88` : NX.border}`,
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s',
                  textAlign: 'left',
                  opacity: !canVote && !isVoted ? 0.85 : 1,
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
                    opacity: isVoted ? 0.16 : 0.05,
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
                      {isVoted ? <PhIcon name="check" size={12} color="#fff" /> : null}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: NX.fg }}>{opt.label}</span>
                  </div>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: isVoted ? NX.primary : NX.fgDim,
                    }}
                  >
                    {pct}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {!membershipResolved ? null : !canVote ? (
          <div style={{ marginTop: 16 }}>
            <PublicCTAFooter
              message={
                closed
                  ? 'Ce sondage est clos.'
                  : !user
                    ? 'Connecte-toi à Nexus pour voter.'
                    : 'Tu n’es pas membre de ce groupe.'
              }
            />
          </div>
        ) : null}
      </div>
    </PublicShell>
  );
}
