/**
 * Dashboard Events — vue plein écran `/app/events`.
 *
 * État J5b sous-jalon #35 : placeholder. Le vrai contenu (calendrier
 * react-day-picker, cards à venir, modal détail/création, RSVP optimiste)
 * sera implémenté dans le sous-jalon #38 (Events bout-en-bout).
 */
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';

export function EventsDashboard() {
  return (
    <FeatureShell
      iconName="calendarBlank"
      iconColor={NX.primaryText}
      iconBg={NX.primaryMuted}
      title="Événements"
      subtitle="Bientôt branché à la DB Drizzle"
      primaryAction={{
        label: 'Nouvel événement',
        onClick: () => {
          // TODO J5b #38 : ouvrir la modal de création
        },
      }}
      filters={
        <>
          <FilterChip label="À venir" active />
          <FilterChip label="Mes RSVP en attente" count={0} />
          <FilterChip label="Passés" />
          <FilterDivider />
          <FilterChip label="Discord · #soirées" accentColor={NX.discord} accentBg={NX.discordBg} />
        </>
      }
    >
      <Placeholder
        title="Dashboard Events bientôt disponible"
        description="Calendrier mensuel, cards à venir, modal RSVP — implémentation J5b #38."
      />
    </FeatureShell>
  );
}
