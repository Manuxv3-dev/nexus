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
import { useEffect, useId, useMemo, useState } from 'react';

import { Button, Field, FieldSet, PhIcon, useGlassDialogFocusTrap } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useCreateExpense,
  useDeleteExpense,
  useGroupMembers,
  useSettleExpenseShare,
  type ExpenseDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { detailPanelShadow, useCopyLink } from '@/screens/features/shared';

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

  const busy = create.isPending === true || del.isPending === true || settle.isPending === true;
  /**
   * Décrit pourquoi « Supprimer »/« Modifier » sont inertes pour ce viewer.
   * `useId()` et non un id statique : plusieurs modales peuvent coexister dans
   * l'arbre, et `getElementById` s'arrête à la première occurrence — un
   * `aria-describedby` résoudrait alors vers le mauvais texte (piège de
   * MAN-245 Phase 3 sur `GroupMembersPanel`).
   */
  const denyHintId = useId();

  // Piège à focus/Escape/retour de focus partagé (MAN-241) — remplace le
  // `useEffect` Escape ad hoc précédent, qui ne respectait pas `busy` (seul
  // le clic overlay le faisait). Chrome custom incompatible avec le rendu
  // de `GlassDialogShell` (cf. sa JSDoc), d'où la mécanique seule.
  const { titleId, containerRef } = useGlassDialogFocusTrap({ onClose, closeDisabled: busy });

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={busy ? undefined : onClose}
      style={overlayStyle}
    >
      <div ref={containerRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={panelStyle}>
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
            <div id={titleId} style={{ fontSize: 15, fontWeight: 500, color: NX.fg }}>
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
              busy={busy}
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
              {/* MAN-246 : grisé plutôt que masqué (même principe que
                  `GroupMembersPanel`) — un membre simple doit comprendre que
                  l'action existe et à qui elle appartient, plutôt que de
                  croire qu'elle n'existe pas. Le serveur reste l'autorité. */}
              <button
                type="button"
                onClick={canEdit ? () => void handleDelete() : undefined}
                disabled={busy}
                aria-disabled={!canEdit}
                {...(canEdit ? {} : { 'aria-describedby': denyHintId })}
                style={{
                  ...chipBtn,
                  color: NX.error,
                  ...(canEdit ? {} : { opacity: 0.55, cursor: 'not-allowed' }),
                }}
              >
                Supprimer
              </button>
              {canEdit ? null : (
                <span id={denyHintId} className="sr-only">
                  Seul l’auteur ou un administrateur du groupe peut supprimer cet élément.
                </span>
              )}
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
  // Préfixe d'instance pour les `htmlFor`/`id` des checkboxes de participation.
  // `useId()` plutôt qu'un `id` dérivé du seul `userId` : deux modales montées
  // en même temps (ou le même membre listé dans deux contextes) produiraient
  // sinon des `id` en doublon, et un `htmlFor` résoudrait vers la mauvaise
  // checkbox — même classe de défaut que les `id` statiques de
  // `GroupMembersPanel` traités en Phase 3.
  const participantsBaseId = useId();

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
        {({ id }) => (
          <input
            id={id}
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Restaurant samedi soir"
            style={inputStyle}
            autoFocus
          />
        )}
      </Field>

      <Field label="Montant (EUR)">
        {({ id }) => (
          <input
            id={id}
            type="text"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="123,45"
            style={inputStyle}
          />
        )}
      </Field>

      <Field label="Payé par">
        {({ id }) => (
          <select
            id={id}
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
        )}
      </Field>

      {/* MAN-245 Phase 2 — le cœur du bug. Cette liste avait deux défauts
          empilés : des `<label>` IMBRIQUÉS (le helper local englobait tout, et
          chaque ligne était elle-même un `<label>`), donc du HTML invalide ; et
          un `<label>` contenant DEUX contrôles, qui n'en nomme que le premier —
          le nom du participant partait sur la checkbox et l'input de montant
          restait anonyme.

          Désormais : `<FieldSet>` nomme le *groupe*, et chaque ligne apparie
          explicitement son `<label htmlFor>` à la seule checkbox. L'input de
          montant reçoit son propre nom, distinct — deux contrôles qui
          partageraient un même nom accessible seraient indiscernables au
          lecteur d'écran, ce qui remplacerait un bug par un autre.

          `<Field>` n'est volontairement pas utilisé pour la ligne : il pose le
          label AU-DESSUS du contrôle, alors qu'une checkbox veut son libellé à
          côté. La garantie est la même (appariement explicite, aucun `<label>`
          englobant), la mise en page diffère. */}
      <FieldSet legend={`Participants (${form.participantIds.length}/${members.length})`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {members.map((m) => {
            const checked = form.participantIds.includes(m.userId);
            const customShare = form.customShares[m.userId];
            const includeId = `${participantsBaseId}-include-${m.userId}`;
            return (
              <div
                key={m.userId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  background: checked ? NX.surface : 'transparent',
                  border: `0.5px solid ${checked ? NX.warning : NX.border}`,
                  borderRadius: NX.radiusSm,
                }}
              >
                <input
                  id={includeId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleParticipant(m.userId)}
                  style={{ accentColor: NX.warning, cursor: 'pointer' }}
                />
                <label
                  htmlFor={includeId}
                  style={{ flex: 1, fontSize: 13, color: NX.fg, cursor: 'pointer' }}
                >
                  {m.displayName}
                </label>
                {form.splitMode === 'equal' && checked && totalCents > 0 ? (
                  <span style={{ fontSize: 12, color: NX.fgMuted }}>{formatCents(equalShare)}</span>
                ) : null}
                {form.splitMode === 'manual' && checked ? (
                  // `aria-label` et non `<Field>` : la ligne n'a pas de place
                  // pour un libellé visible de plus, et le nom doit rester
                  // DISTINCT de celui de la checkbox (« Manu » vs « Part de
                  // Manu »). C'est l'usage légitime d'`aria-label` — nommer un
                  // contrôle compact — à ne pas confondre avec le `placeholder`
                  // que MAN-245 corrige, qui ne nomme rien.
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Part de ${m.displayName}`}
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
              </div>
            );
          })}
        </div>
      </FieldSet>

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
        {({ id }) => (
          <input
            id={id}
            type="text"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="resto, week-end"
            style={inputStyle}
          />
        )}
      </Field>
    </div>
  );
}

// MAN-245 Phase 2 : le helper `Field` local vivait ici — un `<label>` ENGLOBANT,
// copié à l'identique dans les 4 modales features. Correct pour un contrôle
// unique, faux dès qu'il y en a deux : un `<label>` ne s'associe qu'à son
// premier contrôle. Remplacé par la primitive partagée `components/ui/Field`,
// qui pose toujours le `<label htmlFor>` en frère du contrôle.

// ─────────────────────────── View ──────────────────────────────────────

function ViewBody({
  expense,
  userId,
  members,
  busy,
  onToggleSettle,
}: {
  expense: ExpenseDto;
  userId: string | undefined;
  members: { userId: string; displayName: string }[];
  /** Mutation en vol dans la modale (création, suppression ou règlement). */
  busy: boolean;
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
        // Action principale de ExpenseModal (MAN-112 Task 3) : `Button`
        // partagé pour le relief hover/active et le focus clavier ; la
        // couleur par état (réglée/non réglée) reste pilotée par `style`.
        <Button
          onClick={() => onToggleSettle(myShare.isSettled)}
          variant="ghost"
          aria-pressed={myShare.isSettled}
          // MAN-246 : `busy` était bien calculé dans le parent (et incluait
          // `settle.isPending`) mais n'avait jamais été passé jusqu'ici. Sans
          // lui, un double-clic envoyait deux PATCH concurrents portant un
          // toggle inversé — l'état final dépendait de l'ordre d'arrivée des
          // réponses.
          disabled={busy}
          fullWidth
          // `whitespace-normal` neutralise le `whitespace-nowrap` des classes
          // de base de `Button` (override résolu par `cn`/tailwind-merge) : le
          // libellé porte le montant et déborde du panel sous ~400px de large
          // (panel `width: 100%`, max 560) s'il ne peut pas passer à la ligne.
          className="whitespace-normal"
          style={{
            height: 'auto',
            padding: '12px 16px',
            background: myShare.isSettled ? 'transparent' : NX.success,
            color: myShare.isSettled ? NX.success : '#0b1a14',
            border: `1px solid ${NX.success}`,
            borderRadius: NX.radiusSm,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {myShare.isSettled
            ? 'Annuler le règlement'
            : `Marquer ma part (${formatCents(myShare.shareCents, expense.currency)}) comme réglée`}
        </Button>
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
  outline: 'none',
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
