/**
 * Dashboard Expenses — vue plein écran `/app/expenses`.
 *
 * État J5b sous-jalon #35 : placeholder. Vrai contenu en #40.
 */
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';

export function ExpensesDashboard() {
  return (
    <FeatureShell
      iconName="currencyDollar"
      iconColor={NX.warning}
      iconBg={NX.warningBg}
      title="Dépenses"
      subtitle="Bientôt branché à la DB Drizzle"
      primaryAction={{
        label: 'Nouvelle dépense',
        onClick: () => {
          // TODO J5b #40 : ouvrir la modal de création
        },
      }}
      filters={
        <>
          <FilterChip label="Ce mois" active />
          <FilterChip label="Non réglées" count={0} />
          <FilterChip label="Toutes" />
          <FilterDivider />
          <FilterChip label="Discord · #soirées" accentColor={NX.discord} accentBg={NX.discordBg} />
        </>
      }
    >
      <Placeholder
        title="Dashboard Expenses bientôt disponible"
        description="Encart balances, liste transactions, flow régler — implémentation J5b #40."
      />
    </FeatureShell>
  );
}
