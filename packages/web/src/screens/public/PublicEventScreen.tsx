import { useParams } from '@tanstack/react-router';
import { useState } from 'react';

import { Avatar, PhIcon } from '@/components/ui';
import { NX } from '@/lib/tokens';

import { OgMeta } from './og-meta';
import { PublicCTAFooter, PublicHero, PublicShell } from './PublicShell';
import { usePublicEvent } from './hooks';

type Rsvp = 'yes' | 'maybe' | 'no';

export function PublicEventScreen() {
  const { slug } = useParams({ from: '/e/$slug' });
  const eventQ = usePublicEvent(slug);
  const [myRsvp, setMyRsvp] = useState<Rsvp | null>(null);

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
  const yes = Object.values(event.rsvps).filter((v) => v === 'yes').length;
  const maybe = Object.values(event.rsvps).filter((v) => v === 'maybe').length;

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
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    borderRadius: NX.radiusSm,
                    border: `1px solid ${NX.border}`,
                    background: NX.elevated,
                    color: NX.fg,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
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
          {!myRsvp && <PublicCTAFooter />}
        </div>

        <SectionLabel>
          {yes} présents · {maybe} peut-être
        </SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(event.rsvps).map(([name, status]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <Avatar name={name} size={28} />
              <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>{name}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color:
                    status === 'yes'
                      ? NX.success
                      : status === 'maybe'
                        ? NX.warning
                        : status === 'no'
                          ? NX.error
                          : NX.fgGhost,
                }}
              >
                {status === 'yes'
                  ? '✓ Présent'
                  : status === 'maybe'
                    ? '? Peut-être'
                    : status === 'no'
                      ? '✗ Absent'
                      : '· En attente'}
              </span>
            </div>
          ))}
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
