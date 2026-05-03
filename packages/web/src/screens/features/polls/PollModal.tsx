/**
 * Modal Poll — création / lecture (vote inline) + suppression.
 *
 * Cf. J5b #39. Mode :
 *  - 'create' : form question + 2-10 options + multi + closesAt
 *  - 'view'   : question + bar charts + boutons vote (toggle)
 *
 * Pour V1 on n'expose pas l'édition (PATCH) côté UI : on peut juste
 * supprimer et recréer.
 */
import { useEffect, useState } from 'react';

import { Button, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useCreatePoll,
  useDeletePoll,
  useGroupMembers,
  useVote,
  type PollDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

export type PollModalMode = 'create' | 'view';

export interface PollModalProps {
  mode: PollModalMode;
  groupId: string;
  poll?: PollDto;
  canEdit?: boolean;
  onClose: () => void;
}

interface FormState {
  question: string;
  options: string[];
  multi: boolean;
  closesAt: string;
  tags: string;
}

function initialForm(): FormState {
  return {
    question: '',
    options: ['', ''],
    multi: false,
    closesAt: '',
    tags: '',
  };
}

export function PollModal({ mode, groupId, poll, canEdit, onClose }: PollModalProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const create = useCreatePoll();
  const del = useDeletePoll();
  const vote = useVote();
  const { user } = useAuth();
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const busy = create.isPending === true || del.isPending === true;

  async function handleSave() {
    setError(null);
    const question = form.question.trim();
    const opts = form.options.map((o) => o.trim()).filter(Boolean);
    if (!question) return setError('Question requise');
    if (opts.length < 2) return setError('Au moins 2 options');
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      await create.mutateAsync({
        groupId,
        question,
        options: opts,
        multi: form.multi,
        closesAt: form.closesAt ? new Date(form.closesAt).toISOString() : null,
        tags,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleDelete() {
    if (!poll) return;
    if (!window.confirm(`Supprimer le sondage "${poll.question}" ?`)) return;
    try {
      await del.mutateAsync({ pollId: poll.id, groupId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression');
    }
  }

  async function handleVote(optionId: string, currently: boolean) {
    if (!poll) return;
    try {
      await vote.mutateAsync({ pollId: poll.id, optionId, value: !currently });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur vote');
    }
  }

  function handleCopyLink() {
    if (!poll) return;
    const url = `${window.location.origin}/p/${poll.slug}`;
    void navigator.clipboard.writeText(url);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={busy ? undefined : onClose}
      style={overlayStyle}
    >
      <div onClick={(e) => e.stopPropagation()} style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: NX.featPollsBg,
              color: NX.featPolls,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhIcon name="chartBar" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: NX.fg }}>
              {mode === 'create' ? 'Nouveau sondage' : poll?.question ?? 'Sondage'}
            </div>
            {mode === 'view' && poll ? (
              <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>
                {poll.closesAt
                  ? `Clôture ${new Date(poll.closesAt).toLocaleString('fr-FR')}`
                  : 'Sans date de clôture'}
                {' · '}
                {poll.multi ? 'Choix multiples' : 'Choix unique'}
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
            <FormBody form={form} setForm={setForm} />
          ) : poll ? (
            <ViewBody poll={poll} userId={user?.id} members={members} onVote={(o, c) => void handleVote(o, c)} />
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
          {mode === 'view' && poll ? (
            <>
              <button type="button" onClick={handleCopyLink} style={chipBtn}>
                <PhIcon name="link" size={13} />
                <span style={{ marginLeft: 6 }}>Copier le lien</span>
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

function FormBody({ form, setForm }: { form: FormState; setForm: (v: FormState) => void }) {
  function setOpt(idx: number, value: string) {
    const next = [...form.options];
    next[idx] = value;
    setForm({ ...form, options: next });
  }
  function addOpt() {
    if (form.options.length >= 10) return;
    setForm({ ...form, options: [...form.options, ''] });
  }
  function removeOpt(idx: number) {
    if (form.options.length <= 2) return;
    setForm({ ...form, options: form.options.filter((_, i) => i !== idx) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Question">
        <input
          type="text"
          value={form.question}
          onChange={(e) => setForm({ ...form, question: e.target.value })}
          placeholder="On mange quoi ce soir ?"
          style={inputStyle}
          autoFocus
        />
      </Field>
      <Field label={`Options (${form.options.length}/10)`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {form.options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={opt}
                onChange={(e) => setOpt(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                style={{ ...inputStyle, flex: 1 }}
              />
              {form.options.length > 2 ? (
                <button
                  type="button"
                  onClick={() => removeOpt(i)}
                  style={{
                    background: 'transparent',
                    border: `0.5px solid ${NX.border}`,
                    color: NX.fgDim,
                    width: 32,
                    borderRadius: NX.radiusSm,
                    cursor: 'pointer',
                  }}
                >
                  <PhIcon name="x" size={12} />
                </button>
              ) : null}
            </div>
          ))}
          {form.options.length < 10 ? (
            <button
              type="button"
              onClick={addOpt}
              style={{
                background: 'transparent',
                border: `0.5px dashed ${NX.border}`,
                color: NX.fgMuted,
                padding: '8px',
                borderRadius: NX.radiusSm,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              + Ajouter une option
            </button>
          ) : null}
        </div>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: NX.fg }}>
        <input
          type="checkbox"
          checked={form.multi}
          onChange={(e) => setForm({ ...form, multi: e.target.checked })}
        />
        Choix multiples
      </label>
      <Field label="Date de clôture (optionnelle)">
        <input
          type="datetime-local"
          value={form.closesAt}
          onChange={(e) => setForm({ ...form, closesAt: e.target.value })}
          style={inputStyle}
        />
      </Field>
      <Field label="Tags (séparés par virgule)">
        <input
          type="text"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="soiree, vendredi"
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
  poll,
  userId,
  members,
  onVote,
}: {
  poll: PollDto;
  userId: string | undefined;
  members: { id: string; displayName: string }[];
  onVote: (optionId: string, currently: boolean) => void;
}) {
  const totalVotes = poll.options.reduce((s, o) => s + o.voters.length, 0);
  const closed = poll.closesAt ? new Date(poll.closesAt).getTime() <= Date.now() : false;
  const memberNameById = new Map(members.map((m) => [m.id, m.displayName]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {poll.tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {poll.tags.map((t) => (
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {poll.options.map((opt) => {
          const myVote = userId ? opt.voters.includes(userId) : false;
          const pct = totalVotes === 0 ? 0 : Math.round((opt.voters.length / totalVotes) * 100);
          const voterNames = opt.voters
            .map((id) => memberNameById.get(id) ?? id.slice(0, 8))
            .join(', ');
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onVote(opt.id, myVote)}
              disabled={closed}
              style={{
                position: 'relative',
                background: NX.surface,
                border: `0.5px solid ${myVote ? NX.info : NX.border}`,
                borderRadius: NX.radiusSm,
                padding: '12px 14px',
                textAlign: 'left',
                cursor: closed ? 'default' : 'pointer',
                color: NX.fg,
                overflow: 'hidden',
              }}
            >
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  background: NX.featPollsBg,
                  transition: 'width 200ms',
                }}
              />
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13, fontWeight: myVote ? 500 : 400 }}>
                    {opt.label}
                  </span>
                  {opt.voters.length > 0 ? (
                    <span
                      style={{
                        fontSize: 10,
                        color: NX.fgDim,
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {voterNames}
                    </span>
                  ) : null}
                </div>
                <span style={{ fontSize: 12, color: NX.fgMuted, fontWeight: 500 }}>
                  {opt.voters.length} · {pct}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 4 }}>
        {totalVotes} vote{totalVotes > 1 ? 's' : ''}
        {closed ? ' · clos' : ''}
      </div>
    </div>
  );
}

// ─────────────────────────── Styles partagés ───────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 24,
};

const panelStyle: React.CSSProperties = {
  background: NX.elevated,
  borderRadius: NX.radius,
  padding: 0,
  maxWidth: 560,
  width: '100%',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${NX.border}`,
  boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
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
