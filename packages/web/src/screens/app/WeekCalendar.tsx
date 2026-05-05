/**
 * WeekCalendar — composant partagé HomeDashboard + GroupHomeDashboard.
 *
 * Affiche la semaine en cours (Lundi → Dimanche), today highlighted, avec
 * un teaser du 1er event de chaque jour et jusqu'à 3 dots event (puis +N).
 *
 * Le composant est volontairement agnostique du shape exact des events :
 * il accepte n'importe quel type qui satisfait `WeekCalendarEvent` (id +
 * title + startsAt). C'est au parent de mapper son DTO vers cette
 * interface et de gérer la navigation au click.
 */
import { useMemo } from 'react';

import { PhIcon } from '@/components/ui';
import { NX } from '@/lib/tokens';

export interface WeekCalendarEvent {
  id: string;
  title: string;
  /** ISO 8601. */
  startsAt: string;
}

interface WeekCalendarProps<E extends WeekCalendarEvent> {
  events: E[];
  /** Click sur un jour avec event → callback avec le 1er event de ce jour. */
  onEventClick?: ((event: E) => void) | undefined;
}

export function WeekCalendar<E extends WeekCalendarEvent>({
  events,
  onEventClick,
}: WeekCalendarProps<E>) {
  const days = useMemo(() => {
    // Calcule le lundi de la semaine en cours (locale-aware).
    // getDay() retourne 0 (dim) → 6 (sam). On ramène à un offset depuis lundi.
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dayOfWeek = now.getDay();
    const offsetFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - offsetFromMonday);

    const out: { date: Date; events: E[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dStart = d.getTime();
      const dEnd = dStart + 24 * 60 * 60 * 1000;
      const eventsToday = events.filter((e) => {
        const t = new Date(e.startsAt).getTime();
        return t >= dStart && t < dEnd;
      });
      out.push({ date: d, events: eventsToday });
    }
    return out;
  }, [events]);

  const weekdayShort = (d: Date): string =>
    d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');

  return (
    <section
      style={{
        background: NX.surface,
        border: `1px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: '14px 14px 12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: NX.featEventsBg,
            color: NX.featEvents,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PhIcon name="calendarBlank" size={15} />
        </div>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: NX.fg }}>
          Cette semaine
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 8,
        }}
      >
        {days.map((day) => {
          const isToday = day.date.toDateString() === new Date().toDateString();
          const hasEvents = day.events.length > 0;
          const firstEvent = day.events[0];
          return (
            <WeekDayCard
              key={day.date.toISOString()}
              date={day.date}
              weekdayLabel={weekdayShort(day.date)}
              events={day.events}
              isToday={isToday}
              hasEvents={hasEvents}
              onClick={() => {
                if (firstEvent && onEventClick) onEventClick(firstEvent);
              }}
              clickable={!!firstEvent && !!onEventClick}
            />
          );
        })}
      </div>
    </section>
  );
}

function WeekDayCard<E extends WeekCalendarEvent>({
  date,
  weekdayLabel,
  events,
  isToday,
  hasEvents,
  onClick,
  clickable,
}: {
  date: Date;
  weekdayLabel: string;
  events: E[];
  isToday: boolean;
  hasEvents: boolean;
  onClick: () => void;
  clickable: boolean;
}) {
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 6,
        padding: '10px 8px',
        background: isToday ? NX.featEventsBg : NX.elevated,
        border: `1px solid ${isToday ? NX.featEvents : NX.border}`,
        borderRadius: NX.radius,
        cursor: clickable ? 'pointer' : 'default',
        color: 'inherit',
        minHeight: 86,
        textAlign: 'left',
        position: 'relative',
        transition: 'transform 80ms, border-color 120ms, background 120ms',
      }}
      onMouseEnter={(e) => {
        if (clickable) {
          e.currentTarget.style.borderColor = isToday ? NX.featEvents : NX.borderStrong;
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = isToday ? NX.featEvents : NX.border;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
      title={
        hasEvents
          ? events.map((e) => e.title).join(' · ')
          : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', weekday: 'long' })
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 4,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: isToday ? NX.featEvents : NX.fgDim,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {weekdayLabel}
        </span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: isToday ? NX.featEvents : NX.fg,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {date.getDate()}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          justifyContent: 'flex-end',
        }}
      >
        {hasEvents ? (
          <>
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: isToday ? NX.featEvents : NX.fgMuted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.3,
              }}
            >
              {events[0]?.title}
            </div>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 6 }}>
              {events.slice(0, 3).map((e) => (
                <span
                  key={e.id}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 6,
                    background: NX.featEvents,
                  }}
                />
              ))}
              {events.length > 3 ? (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: NX.featEvents,
                    marginLeft: 2,
                  }}
                >
                  +{events.length - 3}
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </button>
  );
}
