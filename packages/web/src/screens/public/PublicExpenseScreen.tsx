/**
 * Page publique dépense `/d/:slug`.
 *
 * Comportement (cf. J5b #40 + sync) :
 *  - Lecture publique : tout le monde voit le détail de la dépense + l'état
 *    de chaque part (mise à jour live via WS dès qu'un membre règle).
 *  - Interaction settle : si l'user est connecté ET membre du groupe ET
 *    a une part dans cette dépense, il peut marquer sa part comme réglée
 *    (mutation backend → WS → invalidate partout).
 */
import { useParams } from '@tanstack/react-router';

import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useGroups, useSettleExpenseShare } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { usePublicExpense } from './hooks';
import { OgMeta } from './og-meta';
import { PublicCTAFooter, PublicHero, PublicShell } from './PublicShell';

export function PublicExpenseScreen() {
  const { slug } = useParams({ from: '/d/$slug' });
  const expenseQ = usePublicExpense(slug);
  const user = useAuth((s) => s.user);
  const authInitializing = useAuth((s) => s.initializing);
  const groupsQ = useGroups();
  const settle = useSettleExpenseShare();

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
  const authReady = !authInitializing;
  const membershipResolved = authReady && (!user || groupsQ.isSuccess);
  const groups = groupsQ.data ?? [];
  const isMember = !!user && groups.some((g) => g.id === expense.groupId);
  const myShare = user ? expense.shares.find((s) => s.userId === user.id) : undefined;
  const canSettle = isMember && myShare && expense.paidBy !== user?.id;

  const handleToggleSettle = () => {
    if (!canSettle || !myShare) return;
    void settle.mutateAsync({ expenseId: expense.id, settled: !myShare.isSettled });
  };

  return (
    <PublicShell>
      <OgMeta
        type="expense"
        slug={slug}
        title={expense.description}
        description={`${total} · ${expense.shares.length} parts${expense.settledAt ? ' · réglée' : ''}`}
      />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 40px' }}>
        <PublicHero
          icon="currencyDollar"
          iconColor={NX.warning}
          iconBg={NX.warningBg}
          type="Dépense"
          groupName="Groupe nexus"
          title={expense.description}
          gradientFrom="rgba(251,191,36,0.1)"
          gradientTo="rgba(249,115,86,0.06)"
          bigValue={
            <div style={{ fontSize: 36, fontWeight: 800, color: NX.warning, marginTop: 10 }}>
              {total}
            </div>
          }
          meta={`Payée le ${new Date(expense.createdAt).toLocaleDateString('fr-FR')}${
            expense.settledAt ? ' · ✓ réglée intégralement' : ''
          }`}
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
          Répartition ({expense.shares.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
          {expense.shares.map((s) => {
            const display = s.userId.slice(0, 8);
            const isPayer = s.userId === expense.paidBy;
            return (
              <div
                key={s.userId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: NX.elevated,
                  borderRadius: NX.radiusSm,
                  border: `1px solid ${s.isSettled ? NX.success : NX.border}`,
                }}
              >
                <Avatar name={display} size={24} />
                <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>
                  {display}
                  {isPayer ? (
                    <span
                      style={{ marginLeft: 6, fontSize: 10, color: NX.warning, fontWeight: 600 }}
                    >
                      A PAYÉ
                    </span>
                  ) : null}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: NX.fg }}>
                  {(s.shareCents / 100).toLocaleString('fr-FR', {
                    style: 'currency',
                    currency: expense.currency,
                  })}
                </span>
                {s.isSettled ? (
                  <span style={{ fontSize: 11, color: NX.success, fontWeight: 600 }}>
                    <PhIcon name="check" size={12} /> réglé
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: NX.fgDim }}>en attente</span>
                )}
              </div>
            );
          })}
        </div>

        {canSettle && myShare ? (
          <button
            type="button"
            onClick={handleToggleSettle}
            disabled={settle.isPending === true || !membershipResolved}
            style={{
              width: '100%',
              padding: '14px 16px',
              background: myShare.isSettled ? 'transparent' : NX.success,
              color: myShare.isSettled ? NX.success : '#0b1a14',
              border: `1px solid ${NX.success}`,
              borderRadius: NX.radiusSm,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {myShare.isSettled
              ? 'Annuler le règlement de ma part'
              : `Marquer ma part (${(myShare.shareCents / 100).toLocaleString('fr-FR', {
                  style: 'currency',
                  currency: expense.currency,
                })}) comme réglée`}
          </button>
        ) : !membershipResolved ? null : (
          <PublicCTAFooter
            message={
              !user
                ? 'Connecte-toi à nexus pour régler ta part.'
                : !isMember
                  ? 'Tu n’es pas membre de ce groupe.'
                  : !myShare
                    ? "Tu n'as pas de part dans cette dépense."
                    : 'Tu es le payeur — pas de règlement à faire.'
            }
          />
        )}
      </div>
    </PublicShell>
  );
}
