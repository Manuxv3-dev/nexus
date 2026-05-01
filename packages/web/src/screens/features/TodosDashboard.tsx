/**
 * Dashboard Todos & listes — vue plein écran `/app/todos`.
 *
 * État J5b sous-jalon #35 : placeholder. Vrai contenu en #41.
 */
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';

export function TodosDashboard() {
  return (
    <FeatureShell
      iconName="listChecks"
      iconColor={NX.success}
      iconBg={NX.successBg}
      title="Listes & tâches"
      subtitle="Bientôt branché à la DB Drizzle"
      primaryAction={{
        label: 'Nouvelle liste',
        onClick: () => {
          // TODO J5b #41 : ouvrir la modal de création
        },
      }}
      filters={
        <>
          <FilterChip label="Actives" active />
          <FilterChip label="Mes tâches" count={0} />
          <FilterChip label="Terminées" />
          <FilterDivider />
          <FilterChip label="Discord · #soirées" accentColor={NX.discord} accentBg={NX.discordBg} />
        </>
      }
    >
      <Placeholder
        title="Dashboard Todos bientôt disponible"
        description="Sidebar listes, vue items, assignation — implémentation J5b #41."
      />
    </FeatureShell>
  );
}
