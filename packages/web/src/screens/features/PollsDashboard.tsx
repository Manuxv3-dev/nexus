/**
 * Dashboard Polls — vue plein écran `/app/polls`.
 *
 * État J5b sous-jalon #35 : placeholder. Vrai contenu en #39.
 */
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';

export function PollsDashboard() {
  return (
    <FeatureShell
      iconName="chartBar"
      iconColor={NX.info}
      iconBg={NX.infoBg}
      title="Sondages"
      subtitle="Bientôt branché à la DB Drizzle"
      primaryAction={{
        label: 'Nouveau sondage',
        onClick: () => {
          // TODO J5b #39 : ouvrir la modal de création
        },
      }}
      filters={
        <>
          <FilterChip label="Actifs" active />
          <FilterChip label="Mes votes en attente" count={0} />
          <FilterChip label="Clos" />
          <FilterDivider />
          <FilterChip label="Discord · #soirées" accentColor={NX.discord} accentBg={NX.discordBg} />
        </>
      }
    >
      <Placeholder
        title="Dashboard Polls bientôt disponible"
        description="Liste cards bar charts, modal vote — implémentation J5b #39."
      />
    </FeatureShell>
  );
}
