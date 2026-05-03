/**
 * Dashboard Expenses — vue panel pour `pane === 'expense'`. Cf. J5b #40.
 *
 * Layout :
 *  - Header bandeau balances (combien je dois / on me doit).
 *  - Filtres : Ouvertes / Réglées / Toutes.
 *  - Grid de cards expenses avec total, payeur, état de règlement.
 *  - Modal de création + modal de view au clic sur une card.
 */
import { useState } from 'react';

import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  computeBalances,
  useExpenses,
  useGroupMembers,
  useGroups,
  type ExpenseDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { ExpenseModal } from './expenses/ExpenseModal';
import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';

type Filter = 'open' | 'settled' | 'all';

export function ExpensesDashboard() {
  const { user } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  const activeGroupId = groups[0]?.id;

  const [filter, setFilter] = useState<Filter>('open');
  // On stocke seulement l'ID de l'expense ouverte — pas l'objet figé. Sinon
  // après une mutation (settle, update), la modal afficherait toujours
  // l'ancienne version et il faudrait fermer/rouvrir pour voir le changement.
  // Avec l'ID, on relit `allExpenses.find(...)` à chaque render donc la modal
  // suit le re-fetch automatique de TanStack Query.
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'view'; expenseId: string } | null
  >(null);

  const expensesQ = useExpenses(activeGroupId, { state: filter });
  const allExpenses = expensesQ.data ?? [];
  const openExpense =
    modal?.mode === 'view' ? allExpenses.find((e) => e.id === modal.expenseId) : undefined;

  // Balances : on les calcule TOUJOURS sur les expenses ouvertes, peu importe
  // le filtre actif (les expenses settled n'apportent rien au solde).
  const expensesForBalance = filter === 'open' ? allExpenses : allExpenses.filter((e) => !e.settledAt);
  const balances = computeBalances(expensesForBalance);

  return (
    <FeatureShell
      iconName="currencyDollar"
      iconColor={NX.featExpenses}
      iconBg={NX.featExpensesBg}
      title="Dépenses"
      subtitle={`${allExpenses.length} ${
        filter === 'settled' ? 'réglées' : filter === 'all' ? 'au total' : 'ouvertes'
      }`}
      primaryAction={{
        label: 'Nouvelle dépense',
        onClick: () => activeGroupId && setModal({ mode: 'create' }),
      }}
      filters={
        <>
          <FilterChip
            label="Ouvertes"
            active={filter === 'open'}
            onClick={() => setFilter('open')}
          />
          <FilterChip
            label="Réglées"
            active={filter === 'settled'}
            onClick={() => setFilter('settled')}
          />
          <FilterChip label="Toutes" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterDivider />
        </>
      }
    >
      {!activeGroupId ? (
        <Placeholder
          title="Aucun groupe actif"
          description="Sélectionne un groupe dans le rail de gauche."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {balances.size > 0 ? <BalancesBanner balances={balances} userId={user?.id} groupId={activeGroupId} /> : null}

          {expensesQ.isLoading ? (
            <div style={{ color: NX.fgMuted, padding: 24 }}>Chargement…</div>
          ) : allExpenses.length === 0 ? (
            <Placeholder
              title={filter === 'settled' ? 'Pas de dépenses réglées' : 'Pas encore de dépenses'}
              description="Crée la première avec le bouton « Nouvelle dépense »."
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: 12,
              }}
            >
              {allExpenses.map((e) => (
                <ExpenseCard
                  key={e.id}
                  expense={e}
                  groupId={activeGroupId}
                  userId={user?.id}
                  onOpen={() => setModal({ mode: 'view', expenseId: e.id })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {modal && activeGroupId ? (
        modal.mode === 'create' ? (
          <ExpenseModal
            mode="create"
            groupId={activeGroupId}
            onClose={() => setModal(null)}
          />
        ) : openExpense ? (
          <ExpenseModal
            mode="view"
            groupId={activeGroupId}
            expense={openExpense}
            canEdit={user ? openExpense.paidBy === user.id : false}
            onClose={() => setModal(null)}
          />
        ) : null
      ) : null}
    </FeatureShell>
  );
}

// ─────────────────────────── Balances Banner ───────────────────────────

function BalancesBanner({
  balances,
  userId,
  groupId,
}: {
  balances: Map<string, number>;
  userId: string | undefined;
  groupId: string;
}) {
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];
  const nameById = new Map(members.map((m) => [m.userId, m.displayName]));
  const myBalance = userId ? balances.get(userId) ?? 0 : 0;
  const others = Array.from(balances.entries()).filter(([id]) => id !== userId);
  others.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  return (
    <div
      style={{
        padding: 16,
        background: NX.surface,
        borderRadius: NX.radius,
        border: `0.5px solid ${NX.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {userId ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 12, color: NX.fgMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Ton solde
          </span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: myBalance > 0 ? NX.success : myBalance < 0 ? NX.error : NX.fgMuted,
            }}
          >
            {myBalance > 0 ? '+' : ''}
            {(myBalance / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
          </span>
          <span style={{ fontSize: 11, color: NX.fgDim }}>
            {myBalance > 0 ? 'on te doit' : myBalance < 0 ? 'tu dois' : 'à jour'}
          </span>
        </div>
      ) : null}

      {others.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {others.slice(0, 6).map(([id, amount]) => {
            const name = nameById.get(id) ?? id.slice(0, 8);
            return (
              <div
                key={id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  background: NX.elevated,
                  borderRadius: NX.radiusPill,
                  fontSize: 12,
                  border: `0.5px solid ${NX.border}`,
                }}
              >
                <Avatar name={name} size={18} />
                <span style={{ color: NX.fgMuted }}>{name}</span>
                <span style={{ color: amount > 0 ? NX.success : amount < 0 ? NX.error : NX.fgMuted, fontWeight: 600 }}>
                  {amount > 0 ? '+' : ''}
                  {(amount / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────── Card ───────────────────────────────────────

function ExpenseCard({
  expense,
  groupId,
  userId,
  onOpen,
}: {
  expense: ExpenseDto;
  groupId: string;
  userId: string | undefined;
  onOpen: () => void;
}) {
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];
  const nameById = new Map(members.map((m) => [m.userId, m.displayName]));
  const payerName = nameById.get(expense.paidBy) ?? expense.paidBy.slice(0, 8);
  const myShare = userId ? expense.shares.find((s) => s.userId === userId) : undefined;
  const settledCount = expense.shares.filter((s) => s.isSettled).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        background: NX.surface,
        border: `0.5px solid ${expense.settledAt ? NX.success : NX.border}`,
        borderRadius: NX.radius,
        padding: 14,
        textAlign: 'left',
        cursor: 'pointer',
        color: NX.fg,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3, flex: 1, marginRight: 8 }}>
          {expense.description}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: NX.warning }}>
          {(expense.amountCents / 100).toLocaleString('fr-FR', {
            style: 'currency',
            currency: expense.currency,
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: NX.fgDim }}>
        <PhIcon name="users" size={11} />
        <span>Payé par {payerName}</span>
        <span style={{ color: NX.fgDim }}>·</span>
        <span>
          {expense.shares.length} part{expense.shares.length > 1 ? 's' : ''}
        </span>
        {settledCount > 0 ? (
          <>
            <span>·</span>
            <span style={{ color: NX.success }}>{settledCount} réglée{settledCount > 1 ? 's' : ''}</span>
          </>
        ) : null}
      </div>

      {myShare ? (
        <div
          style={{
            fontSize: 11,
            padding: '4px 8px',
            background: myShare.isSettled
              ? `${NX.success}1A`
              : expense.paidBy === userId
                ? `${NX.info}1A`
                : `${NX.warning}1A`,
            color: myShare.isSettled
              ? NX.success
              : expense.paidBy === userId
                ? NX.info
                : NX.warning,
            borderRadius: NX.radiusSm,
            alignSelf: 'flex-start',
            fontWeight: 500,
          }}
        >
          {expense.paidBy === userId
            ? 'Tu as payé'
            : myShare.isSettled
              ? 'Ta part est réglée'
              : `Tu dois ${(myShare.shareCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: expense.currency })}`}
        </div>
      ) : null}
    </button>
  );
}
