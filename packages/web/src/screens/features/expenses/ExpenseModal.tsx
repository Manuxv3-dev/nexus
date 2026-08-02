/**
 * Modal Expense — création / lecture (settle inline) + suppression.
 *
 * Cf. J5b #40. Mode :
 *  - 'create' : description + montant + paidBy + participants (split égal ou manuel)
 *  - 'view'   : description + total + payeur + liste shares + bouton settle pour MA part
 *
 * V1 : pas d'édition (PATCH) côté UI — supprime + recrée. Côté backend
 * l'endpoint existe déjà (PATCH /expenses/:expenseId).
 */
import { useEffect, useMemo, useState } from 'react';

import { Button, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useCreateExpense,
  useDeleteExpense,
  useGroupMembers,
  useSettleExpenseShare,
  type ExpenseDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { detailPanelShadow, useCopyLink } from '@/screens/app/killer-features/shared';

export type ExpenseModalMode = 'create' | 'view';

export interface ExpenseModalProps {
  mode: ExpenseModalMode;
  groupId: string;
  expense?: ExpenseDto;
  canEdit?: boolean;
  onClose: () => void;
}

interface FormState {
  description: string;
  /** Montant en EUR saisi par l'user (string pour gérer les virgules). */
  amount: string;
  paidBy: string;
  /** userIds des participants (cochés). */
  participantIds: string[];
  /** Mode de répartition. */
  splitMode: 'equal' | 'manual';
  /** Map userId → cents (utilisé seulement en mode 'manual'). */
  customShares: Record<string, number>;
  tags: string;
}

function initialForm(currentUserId: string | null): FormState {
  return {
    description: '',
    amount: '',
    paidBy: currentUserId ?? '',
    participantIds: [],
    splitMode: 'equal',
    customShares: {},
    tags: '',
  };
}

/** Parse un montant EUR (string) vers cents. Retourne null si invalide. */
function parseAmountToCents(input: string): number | null {
  const clean = input.trim().replace(',', '.').replace(/\s/g, '');
  if (!clean) return null;
  const n = Number.parseFloat(clean);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function formatCents(cents: number, currency = 'EUR'): string {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency });
}

export function ExpenseModal({ mode, groupId, expense, canEdit, onClose }: ExpenseModalProps) {
  const { user } = useAuth();
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];

  const [form, setForm] = useState<FormState>(() => initialForm(user?.id ?? null));
  const [error, setError] = useState<string | null>(null);
  const create = useCreateExpense();
  const del = useDeleteExpense();
  const settle = useSettleExpenseShare();

  // Quand les membres arrivent, on coche tous les membres par défaut (mode
  // create). En mode view on ne touche pas au form.
  useEffect(() => {
    if (mode !== 'create') return;
    if (members.length === 0) return;
    setForm((prev) =>
      prev.participantIds.length === 0
        ? { ...prev, participantIds: members.map((m) => m.userId) }
        : prev,
    );
  }, [members, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const busy = create.isPending === true || del.isPending === true || settle.isPending === true;

  async function handleSave() {
    setError(null);
    const description = form.description.trim();
    if (!description) return setError('Description requise');
    const totalCents = parseAmountToCents(form.amount);
    if (!totalCents) return setError('Montant invalide');
    if (form.participantIds.length === 0) return setError('Au moins un participant');
    if (!form.paidBy) return setError('Choisis qui a payé');

    let shares: { userId: string; shareCents: number }[];
    if (form.splitMode === 'equal') {
      // Split égal : on répartit `totalCents` entre les participants ; le reste
      // (centimes en surplus dû à l'arrondi) est ajouté au payeur s'il fait
      // partie des participants, sinon au 1er participant.
      const base = Math.floor(totalCents / form.participantIds.length);
      const remainder = totalCents - base * form.participantIds.length;
      shares = form.participantIds.map((id) => ({ userId: id, shareCents: base }));
      const bumpIdx = shares.findIndex((s) => s.userId === form.paidBy);
      const idx = bumpIdx >= 0 ? bumpIdx : 0;
      const bumped = shares[idx];
      if (!bumped) throw new Error('split: index hors bornes');
      bumped.shareCents += remainder;
    } else {
      // Manuel : on prend les valeurs saisies par participant.
      shares = form.participantIds.map((id) => ({
        userId: id,
        shareCents: form.customShares[id] ?? 0,
      }));
      const sum = shares.reduce((a, s) => a + s.shareCents, 0);
      if (sum !== totalCents) {
        return setError(
          `La somme des parts (${formatCents(sum)}) doit égaler le total (${formatCents(totalCents)})`,
        );
      }
    }
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await create.mutateAsync({
        groupId,
        description,
        amountCents: totalCents,
        paidBy: form.paidBy,
        shares,
        tags,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création');
    }
  }

  async function handleDelete() {
    if (!expense) return;
    if (!window.confirm(`Supprimer la dépense « ${expense.description} » ?`)) return;
    try {
      await del.mutateAsync({ expenseId: expense.id, groupId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression');
    }
  }

  async function handleToggleSettle(currentlySettled: boolean) {
    if (!expense) return;
    try {
      await settle.mutateAsync({ expenseId: expense.id, settled: !currentlySettled });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur règlement');
    }
  }

  const copyLink = useCopyLink({ slug: expense?.slug, kind: 'd' });

  return (
    <div role="dialog" aria-modal="true" onClick={busy ? undefined : onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: NX.featExpensesBg,
              color: NX.featExpenses,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhIcon name="currencyDollar" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: NX.fg }}>
              {mode === 'create' ? 'Nouvelle dépense' : (expense?.description ?? 'Dépense')}
            </div>
            {mode === 'view' && expense ? (
              <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>
                {formatCents(expense.amountCents, expense.currency)}
                {expense.settledAt
                  ? ` · réglée le ${new Date(expense.settledAt).toLocaleDateString('fr-FR')}`
                  : ' · en cours'}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={onClose} disabled={busy} style={closeBtn}>
            <PhIcon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', overflow: 'auto', flex: 1 }}>
          {mode === 'create' ? (
            <FormBody form={form} setForm={setForm} members={members} />
          ) : expense ? (
            <ViewBody
              expense={expense}
              userId={user?.id}
              members={members}
              onToggleSettle={(s) => void handleToggleSettle(s)}
            />
          ) : null}
          {error ? (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                background: NX.errorBg,
                color: NX.error,
                borderRadius: NX.radiusSm,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          {mode === 'view' && expense ? (
            <>
              <button
                type="button"
                onClick={copyLink.copy}
                style={{
                  ...chipBtn,
                  color:
                    copyLink.state === 'copied'
                      ? NX.success
                      : copyLink.state === 'error'
                        ? NX.error
                        : chipBtn.color,
                  borderColor:
                    copyLink.state === 'copied'
                      ? NX.success
                      : copyLink.state === 'error'
                        ? NX.error
                        : chipBtn.borderColor,
                  fontWeight: copyLink.state !== 'idle' ? 600 : chipBtn.fontWeight,
                  transition: 'all 120ms',
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
                onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                title="Copier le lien public"
              >
                <PhIcon name={copyLink.iconName} size={13} />
                <span style={{ marginLeft: 6 }}>{copyLink.label}</span>
              </button>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={busy}
                  style={{ ...chipBtn, color: NX.error }}
                >
                  Supprimer
                </button>
              ) : null}
              <Button onClick={onClose} variant="primary" size="sm">
                Fermer
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onClose} variant="ghost" size="sm">
                Annuler
              </Button>
              <Button onClick={() => void handleSave()} variant="primary" size="sm" disabled={busy}>
                {busy ? 'Création…' : 'Créer'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Form ──────────────────────────────────────

function FormBody({
  form,
  setForm,
  members,
}: {
  form: FormState;
  setForm: (v: FormState) => void;
  members: { userId: string; displayName: string }[];
}) {
  const totalCents = useMemo(() => parseAmountToCents(form.amount) ?? 0, [form.amount]);
  const equalShare =
    form.splitMode === 'equal' && form.participantIds.length > 0
      ? Math.floor(totalCents / form.participantIds.length)
      : 0;

  function toggleParticipant(userId: string) {
    if (form.participantIds.includes(userId)) {
      setForm({
        ...form,
        participantIds: form.participantIds.filter((id) => id !== userId),
      });
    } else {
      setForm({ ...form, participantIds: [...form.participantIds, userId] });
    }
  }

  function setCustomShare(userId: string, raw: string) {
    const cents = parseAmountToCents(raw) ?? 0;
    setForm({ ...form, customShares: { ...form.customShares, [userId]: cents } });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Description">
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Restaurant samedi soir"
          style={inputStyle}
          autoFocus
        />
      </Field>

      <Field label="Montant (EUR)">
        <input
          type="text"
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          placeholder="123,45"
          style={inputStyle}
        />
      </Field>

      <Field label="Payé par">
        <select
          value={form.paidBy}
          onChange={(e) => setForm({ ...form, paidBy: e.target.value })}
          style={inputStyle}
        >
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </select>
      </Field>

      <Field label={`Participants (${form.participantIds.length}/${members.length})`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {members.map((m) => {
            const checked = form.participantIds.includes(m.userId);
            const customShare = form.customShares[m.userId];
            return (
              <label
                key={m.userId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  background: checked ? NX.surface : 'transparent',
                  border: `0.5px solid ${checked ? NX.warning : NX.border}`,
                  borderRadius: NX.radiusSm,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleParticipant(m.userId)}
                  style={{ accentColor: NX.warning }}
                />
                <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>{m.displayName}</span>
                {form.splitMode === 'equal' && checked && totalCents > 0 ? (
                  <span style={{ fontSize: 12, color: NX.fgMuted }}>{formatCents(equalShare)}</span>
                ) : null}
                {form.splitMode === 'manual' && checked ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={customShare ? (customShare / 100).toString().replace('.', ',') : ''}
                    onChange={(e) => setCustomShare(m.userId, e.target.value)}
                    style={{
                      ...inputStyle,
                      width: 90,
                      padding: '4px 8px',
                      fontSize: 12,
                      textAlign: 'right',
                    }}
                  />
                ) : null}
              </label>
            );
          })}
        </div>
      </Field>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={() => setForm({ ...form, splitMode: 'equal' })}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: form.splitMode === 'equal' ? NX.warningBg : 'transparent',
            color: form.splitMode === 'equal' ? NX.warning : NX.fgMuted,
            border: `0.5px solid ${form.splitMode === 'equal' ? NX.warning : NX.border}`,
            borderRadius: NX.radiusSm,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          Répartition égale
        </button>
        <button
          type="button"
          onClick={() => setForm({ ...form, splitMode: 'manual' })}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: form.splitMode === 'manual' ? NX.warningBg : 'transparent',
            color: form.splitMode === 'manual' ? NX.warning : NX.fgMuted,
            border: `0.5px solid ${form.splitMode === 'manual' ? NX.warning : NX.border}`,
            borderRadius: NX.radiusSm,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          Parts personnalisées
        </button>
      </div>

      <Field label="Tags (séparés par virgule)">
        <input
          type="text"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="resto, week-end"
          style={inputStyle}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: NX.fgMuted }}>{label}</span>
      {children}
    </label>
  );
}

// ─────────────────────────── View ──────────────────────────────────────

function ViewBody({
  expense,
  userId,
  members,
  onToggleSettle,
}: {
  expense: ExpenseDto;
  userId: string | undefined;
  members: { userId: string; displayName: string }[];
  onToggleSettle: (currentlySettled: boolean) => void;
}) {
  const memberNameById = new Map(members.map((m) => [m.userId, m.displayName]));
  const payerName = memberNameById.get(expense.paidBy) ?? expense.paidBy.slice(0, 8);
  const myShare = userId ? expense.shares.find((s) => s.userId === userId) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {expense.tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {expense.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                background: NX.surface,
                border: `0.5px solid ${NX.border}`,
                borderRadius: NX.radiusPill,
                color: NX.fgMuted,
              }}
            >
              #{t}
            </span>
          ))}
        </div>
      ) : null}

      <div
        style={{
          padding: '14px 16px',
          background: NX.surface,
          borderRadius: NX.radiusSm,
          border: `0.5px solid ${NX.border}`,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: NX.fgDim,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Total
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: NX.featExpenses, marginTop: 4 }}>
          {formatCents(expense.amountCents, expense.currency)}
        </div>
        <div style={{ fontSize: 12, color: NX.fgMuted, marginTop: 4 }}>
          Payé par <strong style={{ color: NX.fg }}>{payerName}</strong> ·{' '}
          {new Date(expense.createdAt).toLocaleDateString('fr-FR')}
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 11,
            color: NX.fgDim,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          Répartition ({expense.shares.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {expense.shares.map((s) => {
            const name = memberNameById.get(s.userId) ?? s.userId.slice(0, 8);
            const isMe = userId === s.userId;
            return (
              <div
                key={s.userId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: NX.surface,
                  borderRadius: NX.radiusSm,
                  border: `0.5px solid ${s.isSettled ? NX.success : NX.border}`,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: NX.elevated,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    color: NX.fg,
                  }}
                >
                  {name.charAt(0).toUpperCase()}
                </div>
                <span style={{ flex: 1, fontSize: 13, color: NX.fg }}>
                  {name}
                  {isMe ? ' (toi)' : ''}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: NX.fg }}>
                  {formatCents(s.shareCents, expense.currency)}
                </span>
                {s.isSettled ? (
                  <span style={{ fontSize: 11, color: NX.success, fontWeight: 500 }}>✓ Réglé</span>
                ) : (
                  <span style={{ fontSize: 11, color: NX.fgDim }}>En attente</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {myShare && expense.paidBy !== userId ? (
        <button
          type="button"
          onClick={() => onToggleSettle(myShare.isSettled)}
          style={{
            padding: '12px 16px',
            background: myShare.isSettled ? 'transparent' : NX.success,
            color: myShare.isSettled ? NX.success : '#0b1a14',
            border: `1px solid ${NX.success}`,
            borderRadius: NX.radiusSm,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {myShare.isSettled
            ? 'Annuler le règlement'
            : `Marquer ma part (${formatCents(myShare.shareCents, expense.currency)}) comme réglée`}
        </button>
      ) : null}
    </div>
  );
}

// ─────────────────────────── Styles partagés ───────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 24,
};

const panelStyle: React.CSSProperties = {
  background: NX.glassBg,
  backdropFilter: NX.glassBlur,
  WebkitBackdropFilter: NX.glassBlur,
  borderRadius: NX.radius,
  padding: 0,
  maxWidth: 560,
  width: '100%',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${NX.glassBorder}`,
  boxShadow: detailPanelShadow,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '18px 20px',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  borderBottom: `0.5px solid ${NX.border}`,
};

const footerStyle: React.CSSProperties = {
  padding: '14px 20px',
  display: 'flex',
  gap: 8,
  borderTop: `0.5px solid ${NX.border}`,
  justifyContent: 'flex-end',
  alignItems: 'center',
};

const closeBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: NX.fgDim,
  cursor: 'pointer',
  padding: 4,
};

const chipBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: 'transparent',
  border: `0.5px solid ${NX.border}`,
  color: NX.fgMuted,
  padding: '6px 12px',
  borderRadius: NX.radiusPill,
  fontSize: 12,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: NX.surface,
  border: `0.5px solid ${NX.border}`,
  color: NX.fg,
  padding: '8px 12px',
  borderRadius: NX.radiusSm,
  fontSize: 13,
  outline: 'none',
};
