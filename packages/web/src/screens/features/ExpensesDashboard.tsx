/**
 * Dashboard Expenses — refonte structurelle (cf. ADR-021 + bundle HTML
 * 11-expenses-dashboard.html, J5c).
 *
 * Layout interne au panel main de l'AppShell :
 *  - Main (1fr) : Hero "balance globale" (mon solde + ce qu'on me doit / ce
 *    que je dois aux autres), Stats row, Grid de cards expenses.
 *  - Right rail (340px ≥1280px) : settlements récents + quick create.
 */
import { useEffect, useMemo, useState } from 'react';

import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  computeBalances,
  useExpense,
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

export function ExpensesDashboard({
  openItemId,
  onConsumeOpen,
}: { openItemId?: string | null; onConsumeOpen?: () => void } = {}) {
  const { user } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  const activeGroupId = groups[0]?.id;

  const [filter, setFilter] = useState<Filter>('open');
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'view'; expenseId: string } | null
  >(null);

  // Deep-link depuis une notification : ouvrir l'expense correspondant.
  useEffect(() => {
    if (openItemId) {
      setModal({ mode: 'view', expenseId: openItemId });
      onConsumeOpen?.();
    }
  }, [openItemId, onConsumeOpen]);

  const expensesQ = useExpenses(activeGroupId, { state: filter });
  const allExpenses = expensesQ.data ?? [];
  const openExpenses = useMemo(() => allExpenses.filter((e) => !e.settledAt), [allExpenses]);
  const balances = useMemo(() => computeBalances(openExpenses), [openExpenses]);

  const modalExpenseId = modal?.mode === 'view' ? modal.expenseId : undefined;
  const fromListEx = modalExpenseId ? allExpenses.find((e) => e.id === modalExpenseId) : undefined;
  // Fallback si l'expense n'est pas dans la liste courante (filter actif,
  // deep-link depuis notif).
  const fallbackExpenseQ = useExpense(fromListEx ? undefined : modalExpenseId);
  const openExpense = fromListEx ?? fallbackExpenseQ.data;

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
          <FilterChip label="Ouvertes" active={filter === 'open'} onClick={() => setFilter('open')} />
          <FilterChip label="Réglées" active={filter === 'settled'} onClick={() => setFilter('settled')} />
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
      ) : expensesQ.isLoading ? (
        <div style={{ color: NX.fgMuted, padding: 24 }}>Chargement…</div>
      ) : (
        <div style={dashLayout}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {balances.size > 0 && user ? (
              <BalanceHero balances={balances} userId={user.id} groupId={activeGroupId} />
            ) : null}

            <ExpensesStatsRow allExpenses={allExpenses} userId={user?.id} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <SectionHeader
                title={filter === 'settled' ? 'Dépenses réglées' : filter === 'all' ? 'Toutes' : 'En cours'}
                count={allExpenses.length}
              />
              {allExpenses.length === 0 ? (
                <Placeholder
                  title={filter === 'settled' ? 'Pas de dépenses réglées' : 'Pas encore de dépenses'}
                  description="Crée la première avec « Nouvelle dépense »."
                />
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
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
          </div>

          {/* RIGHT RAIL */}
          <div style={rightRailStyle}>
            <ExpensesActivityFeed expenses={allExpenses} userId={user?.id} groupId={activeGroupId} />
            <QuickCreate onCreate={() => activeGroupId && setModal({ mode: 'create' })} />
          </div>
        </div>
      )}

      {modal && activeGroupId ? (
        modal.mode === 'create' ? (
          <ExpenseModal mode="create" groupId={activeGroupId} onClose={() => setModal(null)} />
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

// ─────────────────────────── Layout ────────────────────────────────────

const dashLayout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 340px',
  gap: 20,
  alignItems: 'start',
};

const rightRailStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  position: 'sticky',
  top: 16,
};

// ─────────────────────────── Hero (balance) ────────────────────────────

function BalanceHero({
  balances,
  userId,
  groupId,
}: {
  balances: Map<string, number>;
  userId: string;
  groupId: string;
}) {
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];
  const nameById = new Map(members.map((m) => [m.userId, m.displayName]));
  const myBalance = balances.get(userId) ?? 0;
  const others = Array.from(balances.entries()).filter(([id]) => id !== userId);
  const owedToMe = others.filter(([_, b]) => b < 0); // ils me doivent (négatif chez eux)
  const iOwe = others.filter(([_, b]) => b > 0);     // ils ont positif → je leur dois

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${NX.featExpensesBg} 0%, transparent 80%), ${NX.surface}`,
        border: `0.5px solid ${NX.featExpenses}33`,
        borderRadius: NX.radiusXl,
        padding: 24,
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: NX.featExpenses,
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Mon solde dans ce groupe
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <span
          style={{
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: myBalance > 0 ? NX.success : myBalance < 0 ? NX.error : NX.fg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {myBalance > 0 ? '+' : ''}
          {(myBalance / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
        </span>
        <span style={{ fontSize: 13, color: NX.fgMuted }}>
          {myBalance > 0 ? 'on te doit' : myBalance < 0 ? 'tu dois' : 'à jour'}
        </span>
      </div>

      {/* Détail "qui doit à qui" */}
      {others.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <BalanceColumn
            title="On te doit"
            items={owedToMe.map(([id, amount]) => ({
              id,
              name: nameById.get(id) ?? id.slice(0, 8),
              amount: -amount, // ils ont -, donc le montant qu'ils me doivent est positif
            }))}
            color={NX.success}
            empty="Personne ne te doit"
          />
          <BalanceColumn
            title="Tu dois à"
            items={iOwe.map(([id, amount]) => ({
              id,
              name: nameById.get(id) ?? id.slice(0, 8),
              amount,
            }))}
            color={NX.error}
            empty="Tu ne dois rien"
          />
        </div>
      ) : null}
    </div>
  );
}

function BalanceColumn({
  title,
  items,
  color,
  empty,
}: {
  title: string;
  items: { id: string; name: string; amount: number }[];
  color: string;
  empty: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: NX.fgDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: NX.fgGhost }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.slice(0, 4).map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar name={item.name} size={22} />
              <span style={{ fontSize: 12, color: NX.fg, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
                {(item.amount / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
              </span>
            </div>
          ))}
          {items.length > 4 ? (
            <div style={{ fontSize: 11, color: NX.fgGhost, marginTop: 2 }}>
              +{items.length - 4} autre{items.length - 4 > 1 ? 's' : ''}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Stats ─────────────────────────────────────

function ExpensesStatsRow({ allExpenses, userId }: { allExpenses: ExpenseDto[]; userId: string | undefined }) {
  const open = allExpenses.filter((e) => !e.settledAt);
  const settled = allExpenses.filter((e) => !!e.settledAt);
  const totalOpen = open.reduce((s, e) => s + e.amountCents, 0);
  const myShareOpen = userId
    ? open.reduce((s, e) => {
        const share = e.shares.find((sh) => sh.userId === userId);
        return s + (share && !share.isSettled ? share.shareCents : 0);
      }, 0)
    : 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      <StatCard icon="receipt" label="En cours" value={open.length.toString()} unit="dépenses" />
      <StatCard
        icon="coins"
        label="Total ouvert"
        value={(totalOpen / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
        unit="€"
      />
      <StatCard
        icon="checks"
        label="Réglées"
        value={settled.length.toString()}
        unit={`/ ${allExpenses.length}`}
      />
    </div>
  );
}

function StatCard({
  icon, label, value, unit,
}: { icon: 'receipt' | 'coins' | 'checks'; label: string; value: string; unit: string }) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: NX.fgMuted, fontWeight: 500, marginBottom: 6 }}>
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: NX.fg, fontVariantNumeric: 'tabular-nums' }}>
        {value}
        <span style={{ fontSize: 11, color: NX.fgDim, fontWeight: 500, marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  );
}

// ─────────────────────────── Section header ────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: NX.fg, margin: 0, letterSpacing: '-0.01em' }}>
        {title}
      </h3>
      <span style={{ fontSize: 11, color: NX.fgDim }}>{count}</span>
    </div>
  );
}

// ─────────────────────────── Right rail ────────────────────────────────

function ExpensesActivityFeed({
  expenses,
  userId,
  groupId,
}: {
  expenses: ExpenseDto[];
  userId: string | undefined;
  groupId: string | undefined;
}) {
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];
  const nameById = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName])),
    [members],
  );

  // Activity = expenses récentes triées par updatedAt desc, top 5
  const activity = useMemo(() => {
    return [...expenses]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [expenses]);

  const displayNameOf = (uid: string) =>
    uid === userId ? 'Toi' : nameById.get(uid) ?? uid.slice(0, 6);

  return (
    <RailBlock icon="clock" title="Activité récente">
      {activity.length === 0 ? (
        <div style={{ fontSize: 12, color: NX.fgDim }}>Aucune dépense.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activity.map((e) => {
            const name = displayNameOf(e.paidBy);
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={name} size={22} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <span style={{ color: NX.fg, fontWeight: 500 }}>{name}</span>
                  <span style={{ color: NX.fgMuted }}> a payé </span>
                  <span style={{ color: NX.featExpenses, fontWeight: 600 }}>
                    {(e.amountCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: e.currency })}
                  </span>
                  <div style={{ color: NX.fgDim, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </RailBlock>
  );
}

function QuickCreate({ onCreate }: { onCreate: () => void }) {
  return (
    <RailBlock icon="plusCircle" title="Créer rapidement">
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 12px',
          background: NX.featExpensesBg,
          border: `0.5px dashed ${NX.featExpenses}55`,
          borderRadius: NX.radiusMd,
          color: NX.featExpenses,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <PhIcon name="plus" size={16} color={NX.featExpenses} />
        Nouvelle dépense
      </button>
      <div style={{ fontSize: 11, color: NX.fgGhost, marginTop: 8, lineHeight: 1.4 }}>
        Resto, courses, billet train ? Split en 2 clics.
      </div>
    </RailBlock>
  );
}

function RailBlock({ icon, title, children }: { icon: 'clock' | 'plusCircle'; title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: NX.fgMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {title}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────── Card ──────────────────────────────────────

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
  const nameById = new Map((membersQ.data ?? []).map((m) => [m.userId, m.displayName]));
  const payerName = nameById.get(expense.paidBy) ?? expense.paidBy.slice(0, 6);
  const myShare = userId ? expense.shares.find((s) => s.userId === userId) : undefined;
  const settledShares = expense.shares.filter((s) => s.isSettled).length;
  const isFullySettled = !!expense.settledAt;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        background: NX.surface,
        border: `0.5px solid ${isFullySettled ? NX.border : `${NX.featExpenses}33`}`,
        borderRadius: NX.radiusLg,
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
        <div style={{ fontSize: 16, fontWeight: 700, color: NX.featExpenses, fontVariantNumeric: 'tabular-nums' }}>
          {(expense.amountCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: expense.currency })}
        </div>
      </div>
      <div style={{ fontSize: 11, color: NX.fgDim }}>
        Payé par <b style={{ color: NX.fgMuted }}>{payerName}</b>
        {' · '}
        {settledShares} / {expense.shares.length} parts réglées
      </div>
      {myShare ? (
        <div
          style={{
            fontSize: 11,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            background: myShare.isSettled ? NX.successBg : NX.warningBg,
            color: myShare.isSettled ? NX.success : NX.warning,
            borderRadius: NX.radiusPill,
            alignSelf: 'flex-start',
            fontWeight: 600,
          }}
        >
          {myShare.isSettled ? '✓' : '·'} Ma part :{' '}
          {(myShare.shareCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: expense.currency })}
        </div>
      ) : null}
    </button>
  );
}
