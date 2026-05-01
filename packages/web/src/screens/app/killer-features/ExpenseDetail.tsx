import { useState } from 'react';

import { Avatar, Button, PhIcon } from '@/components/ui';
import { useExpenses } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { FeatureHeader, PanelEmpty, PanelRoot } from './shared';

type Tab = 'expenses' | 'balances';

function formatAmount(cents: number, currency = 'EUR') {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency });
}

export function ExpenseDetail({ groupId }: { groupId: string }) {
  const expensesQ = useExpenses(groupId);
  const data = expensesQ.data;
  const [tab, setTab] = useState<Tab>('expenses');

  if (expensesQ.isLoading) return <PanelRoot><PanelEmpty title="Chargement…" /></PanelRoot>;

  const expenses = data?.expenses ?? [];
  const balances = data?.balances ?? [];
  const totalCents = expenses.reduce((s, e) => s + e.amountCents, 0);

  if (expenses.length === 0 && balances.length === 0) {
    return (
      <PanelRoot>
        <FeatureHeader
          icon="currencyDollar"
          iconColor={NX.warning}
          iconBg={NX.warningBg}
          title="Dépenses"
          subtitle="Aucune dépense"
        />
        <PanelEmpty
          title="Pas de dépenses partagées"
          hint="Ajoute la première dépense de ton groupe."
        />
      </PanelRoot>
    );
  }

  return (
    <PanelRoot>
      <div style={{ borderBottom: `1px solid ${NX.border}` }}>
        <FeatureHeader
          icon="currencyDollar"
          iconColor={NX.warning}
          iconBg={NX.warningBg}
          title="Dépenses du groupe"
          subtitle={`Total : ${formatAmount(totalCents)} · ${expenses.length} dépenses`}
        />
        <div style={{ display: 'flex', gap: 0, padding: '0 20px 0' }}>
          {(['expenses', 'balances'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '9px 0',
                fontSize: 12,
                fontWeight: 600,
                background: 'transparent',
                border: 'none',
                color: tab === t ? NX.fg : NX.fgDim,
                borderBottom: `2px solid ${tab === t ? NX.primary : 'transparent'}`,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {t === 'expenses' ? 'Dépenses' : 'Qui doit quoi'}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: '12px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          overflow: 'auto',
        }}
      >
        {tab === 'expenses' &&
          expenses.map((e) => (
            <div
              key={e.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: NX.elevated,
                borderRadius: NX.radiusSm,
                border: `1px solid ${NX.border}`,
              }}
            >
              <Avatar name={e.paidBy} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: NX.fg }}>{e.description}</div>
                <div style={{ fontSize: 11, color: NX.fgDim }}>
                  Payé par {e.paidBy} · {new Date(e.createdAt).toLocaleDateString('fr-FR')}
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: NX.fg, flexShrink: 0 }}>
                {formatAmount(e.amountCents, e.currency)}
              </span>
            </div>
          ))}

        {tab === 'balances' &&
          balances.map((b, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                background: NX.elevated,
                borderRadius: NX.radiusSm,
                border: `1px solid ${NX.border}`,
              }}
            >
              <Avatar name={b.from} size={24} />
              <span style={{ fontSize: 12, color: NX.fgMuted }}>doit</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NX.warning }}>
                {formatAmount(b.amountCents)}
              </span>
              <span style={{ fontSize: 12, color: NX.fgMuted }}>à</span>
              <Avatar name={b.to} size={24} />
              <span style={{ fontSize: 13, fontWeight: 500, color: NX.fg }}>{b.to}</span>
              <button
                style={{
                  marginLeft: 'auto',
                  padding: '4px 10px',
                  borderRadius: NX.radiusPill,
                  background: NX.successBg,
                  color: NX.success,
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Réglé
              </button>
            </div>
          ))}
      </div>

      <div style={{ padding: '12px 20px', borderTop: `1px solid ${NX.border}` }}>
        <Button fullWidth size="md" leftIcon={<PhIcon name="plus" size={16} color="#fff" />}>
          Ajouter une dépense
        </Button>
      </div>
    </PanelRoot>
  );
}
