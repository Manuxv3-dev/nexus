import { useParams } from '@tanstack/react-router';

import { Avatar } from '@/components/ui';
import { NX } from '@/lib/tokens';

import { OgMeta } from './og-meta';
import { PublicHero, PublicShell } from './PublicShell';
import { usePublicExpense } from './hooks';

export function PublicExpenseScreen() {
  const { slug } = useParams({ from: '/d/$slug' });
  const expenseQ = usePublicExpense(slug);

  if (expenseQ.isLoading)
    return (
      <PublicShell>
        <div style={{ padding: 80, textAlign: 'center', color: NX.fgDim }}>Chargement…</div>
      </PublicShell>
    );
  if (!expenseQ.data)
    return (
      <PublicShell>
        <div style={{ padding: 80, textAlign: 'center', color: NX.fg }}>Dépense introuvable</div>
      </PublicShell>
    );

  const expense = expenseQ.data;
  const total = (expense.amountCents / 100).toLocaleString('fr-FR', {
    style: 'currency',
    currency: expense.currency,
  });
  const sharePerPerson =
    expense.participants.length > 0
      ? (expense.amountCents / expense.participants.length / 100).toLocaleString('fr-FR', {
          style: 'currency',
          currency: expense.currency,
        })
      : '—';

  return (
    <PublicShell>
      <OgMeta
        type="expense"
        slug={slug}
        title={expense.description}
        description={`${total} payé par ${expense.paidBy} · ${sharePerPerson}/personne`}
      />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 40px' }}>
        <PublicHero
          icon="currencyDollar"
          iconColor={NX.warning}
          iconBg={NX.warningBg}
          type="Dépense"
          groupName="Groupe Nexus"
          title={expense.description}
          gradientFrom="rgba(251,191,36,0.1)"
          gradientTo="rgba(249,115,86,0.06)"
          bigValue={
            <div style={{ fontSize: 36, fontWeight: 800, color: NX.warning, marginTop: 10 }}>
              {total}
            </div>
          }
          meta={`Payé par ${expense.paidBy} · ${new Date(expense.createdAt).toLocaleDateString(
            'fr-FR',
          )}`}
        />

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
          Répartition ({expense.participants.length} personnes)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
          {expense.participants.map((name) => (
            <div
              key={name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: NX.elevated,
                borderRadius: NX.radiusSm,
                border: `1px solid ${NX.border}`,
              }}
            >
              <Avatar name={name} size={24} />
              <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>{name}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NX.fg }}>{sharePerPerson}</span>
            </div>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}
