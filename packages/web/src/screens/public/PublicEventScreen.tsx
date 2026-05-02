import { useParams } from '@tanstack/react-router';

import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useEventRsvp, useGroups } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { OgMeta } from './og-meta';
import { PublicCTAFooter, PublicHero, PublicShell } from './PublicShell';
import { usePublicEvent } from './hooks';

type Rsvp = 'yes' | 'maybe' | 'no';

export function PublicEventScreen() {
  const { slug } = useParams({ from: '/e/$slug' });
  const eventQ = usePublicEvent(slug);
  const user = useAuth((s) => s.user);
  const authInitializing = useAuth((s) => s.initializing);
  const groupsQ = useGroups();
  const rsvpMut = useEventRsvp();

  if (eventQ.isLoading)
    return (
      <PublicShell>
        <Loading />
      </PublicShell>
    );
  if (!eventQ.data)
    return (
      <PublicShell>
        <NotFound kind="événement" />
      </PublicShell>
    );

  const event = eventQ.data;
  const yes = event.rsvps.filter((r) => r.value === 'yes').length;
  const maybe = event.rsvps.filter((r) => r.value === 'maybe').length;
  // Tant que l'auth s'initialise OU que la liste des groupes charge,
  // on considère l'état d'appartenance comme « inconnu » et on n'affiche
  // pas le CTA « non auth » / « non membre ». Sinon on flashe un message
  // erroné quand la session est en réalité active.
  const authReady = !authInitializing;
  const membershipResolved = authReady && (!user || groupsQ.isSuccess);
  const groups = groupsQ.data ?? [];
  const isMember = !!user && groups.some((g) => g.id === event.groupId);
  const myRsvp = user ? event.rsvps.find((r) => r.userId === user.id)?.value ?? null : null;
  const canRsvp = isMember;
  const setMyRsvp = (value: Rsvp | null) => {
    if (!canRsvp) return;
    void rsvpMut.mutateAsync({ eventId: event.id, value });
  };

  return (
    <PublicShell>
      <OgMeta
        type="event"
        slug={slug}
        title={event.title}
        description={event.description ?? `${yes} oui · ${maybe} peut-être · ${event.location ?? ''}`}
      />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 40px' }}>
        <PublicHero
          icon="calendarBlank"
          iconColor={NX.primaryText}
          iconBg={NX.primaryMuted}
          type="Événement"
          groupName="Groupe Nexus"
          title={event.title}
          gradientFrom={`${NX.primary}22`}
          gradientTo={`${NX.accent}15`}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <InfoRow icon="clock">
            {new Date(event.startsAt).toLocaleString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </InfoRow>
          {event.location && <InfoRow icon="mapPin">{event.location}</InfoRow>}
        </div>

        {event.description && (
          <div style={{ fontSize: 14, color: NX.fgMuted, lineHeight: 1.6, marginBottom: 20 }}>
            {event.description}
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Ta réponse</SectionLabel>
          {myRsvp ? (
            <div
              style={{
                padding: '14px 16px',
                background: NX.successBg,
                borderRadius: NX.radius,
                border: `1px solid rgba(52,211,153,0.2)`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <PhIcon name="check" size={18} color={NX.success} />
              <span style={{ fontSize: 14, fontWeight: 600, color: NX.success }}>
                {myRsvp === 'yes'
                  ? 'Tu es inscrit !'
                  : myRsvp === 'maybe'
                    ? 'Noté comme peut-être'
                    : 'Tu ne viens pas'}
              </span>
              <button
                onClick={() => setMyRsvp(null)}
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  border: 'none',
                  color: NX.fgDim,
                  fontSize: 11,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Changer
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {(
                [
                  { val: 'yes', label: "J'y serai !", color: NX.success },
                  { val: 'maybe', label: 'Peut-être', color: NX.warning },
                  { val: 'no', label: 'Pas dispo', color: NX.error },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => setMyRsvp(opt.val)}
                  disabled={!canRsvp || rsvpMut.isPending === true || !membershipResolved}
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    borderRadius: NX.radiusSm,
                    border: `1px solid ${NX.border}`,
                    background: NX.elevated,
                    color: NX.fg,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: canRsvp ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    opacity: canRsvp ? 1 : 0.55,
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: opt.color,
                    }}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {!membershipResolved ? null : !canRsvp ? (
            <PublicCTAFooter
              message={
                !user
                  ? 'Connecte-toi à Nexus pour répondre à cet événement.'
                  : 'Tu n’es pas membre de ce groupe.'
              }
            />
          ) : !myRsvp ? (
            <PublicCTAFooter />
          ) : null}
        </div>

        <SectionLabel>
          {yes} présents · {maybe} peut-être
        </SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {event.rsvps.length === 0 ? (
            <div style={{ fontSize: 12, color: NX.fgDim, fontStyle: 'italic', padding: '8px 0' }}>
              Personne n'a encore répondu.
            </div>
          ) : (
            event.rsvps.map((r) => {
              const display = r.userId.slice(0, 8);
              return (
                <div
                  key={r.userId}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}
                >
                  <Avatar name={display} size={28} />
                  <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>{display}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color:
                        r.value === 'yes'
                          ? NX.success
                          : r.value === 'maybe'
                            ? NX.warning
                            : NX.error,
                    }}
                  >
                    {r.value === 'yes'
                      ? '✓ Présent'
                      : r.value === 'maybe'
                        ? '? Peut-être'
                        : '✗ Absent'}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </PublicShell>
  );
}

function InfoRow({
  icon,
  children,
}: {
  icon: 'clock' | 'mapPin';
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: NX.elevated,
        borderRadius: NX.radiusSm,
        border: `1px solid ${NX.border}`,
      }}
    >
      <PhIcon name={icon} size={18} color={NX.fgDim} />
      <span style={{ fontSize: 14, color: NX.fg }}>{children}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: NX.fgDim,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function Loading() {
  return (
    <div style={{ padding: 80, textAlign: 'center', color: NX.fgDim }}>Chargement…</div>
  );
}
function NotFound({ kind }: { kind: string }) {
  return (
    <div style={{ padding: 80, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: NX.fg }}>Cet {kind} n'existe pas</div>
      <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 6 }}>
        Le lien est peut-être expiré ou invalide.
      </div>
    </div>
  );
}
