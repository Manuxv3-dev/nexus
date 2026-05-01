import { useState } from 'react';

import { Avatar, Badge, PhIcon } from '@/components/ui';
import { useEvents } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { CopyLinkButton, FeatureHeader, PanelEmpty, PanelRoot } from './shared';

type Rsvp = 'yes' | 'maybe' | 'no';

const STATUS_LABEL: Record<Rsvp, string> = {
  yes: 'Présent',
  maybe: 'Peut-être',
  no: 'Absent',
};
const STATUS_COLOR: Record<Rsvp, string> = {
  yes: NX.success,
  maybe: NX.warning,
  no: NX.error,
};
const STATUS_ICON: Record<Rsvp, string> = {
  yes: '✓',
  maybe: '?',
  no: '✗',
};

export function EventDetail({ groupId }: { groupId: string }) {
  const eventsQ = useEvents(groupId);
  const event = eventsQ.data?.[0];
  const [myRsvp, setMyRsvp] = useState<Rsvp | null>(null);

  if (eventsQ.isLoading) return <PanelRoot><PanelEmpty title="Chargement…" /></PanelRoot>;
  if (!event) {
    return (
      <PanelRoot>
        <FeatureHeader
          icon="calendarBlank"
          iconColor={NX.primaryText}
          iconBg={NX.primaryMuted}
          title="Événements"
          subtitle="Aucun événement"
        />
        <PanelEmpty
          title="Pas d'événement à venir"
          hint="Crée-en un pour proposer une date à ta bande."
        />
      </PanelRoot>
    );
  }

  const counts: Record<Rsvp | 'pending', number> = { yes: 0, maybe: 0, no: 0, pending: 0 };
  for (const v of Object.values(event.rsvps)) {
    if (v) counts[v] += 1;
    else counts.pending += 1;
  }

  const formattedDate = new Date(event.startsAt).toLocaleString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <PanelRoot>
      <FeatureHeader
        icon="calendarBlank"
        iconColor={NX.primaryText}
        iconBg={NX.primaryMuted}
        title={event.title}
        subtitle={`Créé par ${event.createdBy}`}
        action={<CopyLinkButton slug={event.slug} kind="e" />}
      />

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Row icon="clock">{formattedDate}</Row>
        {event.location && <Row icon="mapPin">{event.location}</Row>}
        {event.description && (
          <Row icon="chatCircle">
            <span style={{ color: NX.fgMuted, lineHeight: 1.5 }}>{event.description}</span>
          </Row>
        )}
      </div>

      <div style={{ padding: '0 20px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="success">{counts.yes} présents</Badge>
        <Badge tone="warning">{counts.maybe} peut-être</Badge>
        <Badge tone="error">{counts.no} absent</Badge>
        {counts.pending > 0 && <Badge tone="neutral">{counts.pending} en attente</Badge>}
      </div>

      <div
        style={{
          padding: '16px 20px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: NX.fgDim,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: 4,
          }}
        >
          Participants
        </div>
        {Object.entries(event.rsvps).map(([name, status]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
            <Avatar name={name} size={26} />
            <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>{name}</span>
            {status ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: STATUS_COLOR[status],
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {STATUS_ICON[status]} {STATUS_LABEL[status]}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: NX.fgGhost }}>En attente</span>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          padding: '12px 20px',
          borderTop: `1px solid ${NX.border}`,
          display: 'flex',
          gap: 8,
        }}
      >
        {(Object.keys(STATUS_LABEL) as Rsvp[]).map((s) => {
          const active = myRsvp === s;
          return (
            <button
              key={s}
              onClick={() => setMyRsvp(s)}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: NX.radiusPill,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: active ? `${STATUS_COLOR[s]}22` : NX.elevated,
                color: active ? STATUS_COLOR[s] : NX.fgMuted,
                border: `1px solid ${active ? `${STATUS_COLOR[s]}44` : NX.border}`,
                transition: 'all 0.2s',
              }}
            >
              {STATUS_ICON[s]} {STATUS_LABEL[s]}
            </button>
          );
        })}
      </div>
    </PanelRoot>
  );
}

function Row({ icon, children }: { icon: 'clock' | 'mapPin' | 'chatCircle'; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <PhIcon name={icon} size={16} color={NX.fgDim} style={{ marginTop: 2 }} />
      <span style={{ fontSize: 13, color: NX.fg }}>{children}</span>
    </div>
  );
}
