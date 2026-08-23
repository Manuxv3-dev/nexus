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
import { useId, useState } from 'react';

import { Button, Field, FieldSet, PhIcon, useGlassDialogFocusTrap } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useCreatePoll,
  useDeletePoll,
  useGroupMembers,
  useVote,
  type PollDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { detailPanelShadow, useCopyLink } from '@/screens/features/shared';

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

  const busy = create.isPending === true || del.isPending === true;
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
    const question = form.question.trim();
    const opts = form.options.map((o) => o.trim()).filter(Boolean);
    if (!question) return setError('Question requise');
    if (opts.length < 2) return setError('Au moins 2 options');
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
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

  const copyLink = useCopyLink({ slug: poll?.slug, kind: 'p' });

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
            <div id={titleId} style={{ fontSize: 15, fontWeight: 500, color: NX.fg }}>
              {mode === 'create' ? 'Nouveau sondage' : (poll?.question ?? 'Sondage')}
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
            <ViewBody
              poll={poll}
              userId={user?.id}
              members={members}
              onVote={(o, c) => void handleVote(o, c)}
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
          {mode === 'view' && poll ? (
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
        {({ id }) => (
          <input
            id={id}
            type="text"
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            placeholder="On mange quoi ce soir ?"
            style={inputStyle}
            autoFocus
          />
        )}
      </Field>
      {/* MAN-245 Phase 2 — un `<label>` unique ne s'associe qu'à son PREMIER
          contrôle : l'option 1 était nommée, les options 2 à 10 n'avaient qu'un
          `placeholder`, qui disparaît à la saisie. `<FieldSet>` nomme le groupe,
          et chaque input reçoit son propre nom.

          `aria-label` plutôt qu'un `<Field>` par option : dix libellés visibles
          empileraient autant de lignes de texte pour une information déjà portée
          par la position. Le `placeholder` est conservé comme repère visuel — il
          ne nomme plus rien, c'est le rôle de l'`aria-label`. */}
      <FieldSet legend={`Options (${form.options.length}/10)`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {form.options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                aria-label={`Option ${i + 1}`}
                value={opt}
                onChange={(e) => setOpt(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                style={{ ...inputStyle, flex: 1 }}
              />
              {form.options.length > 2 ? (
                <button
                  type="button"
                  // Bouton à icône seule : sans ceci, il n'a aucun nom
                  // accessible et se lit « bouton » au lecteur d'écran.
                  aria-label={`Supprimer l'option ${i + 1}`}
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
      </FieldSet>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: NX.fg }}>
        <input
          type="checkbox"
          checked={form.multi}
          onChange={(e) => setForm({ ...form, multi: e.target.checked })}
        />
        Choix multiples
      </label>
      <Field label="Date de clôture (optionnelle)">
        {({ id }) => (
          <input
            id={id}
            type="datetime-local"
            value={form.closesAt}
            onChange={(e) => setForm({ ...form, closesAt: e.target.value })}
            style={inputStyle}
          />
        )}
      </Field>
      <Field label="Tags (séparés par virgule)">
        {({ id }) => (
          <input
            id={id}
            type="text"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="soiree, vendredi"
            style={inputStyle}
          />
        )}
      </Field>
    </div>
  );
}

// MAN-245 Phase 2 : helper `Field` local supprimé (`<label>` englobant, copié
// dans les 4 modales features) au profit de la primitive `components/ui/Field`.

// ─────────────────────────── View ──────────────────────────────────────

function ViewBody({
  poll,
  userId,
  members,
  onVote,
}: {
  poll: PollDto;
  userId: string | undefined;
  members: { userId: string; displayName: string }[];
  onVote: (optionId: string, currently: boolean) => void;
}) {
  const totalVotes = poll.options.reduce((s, o) => s + o.voters.length, 0);
  const closed = poll.closesAt ? new Date(poll.closesAt).getTime() <= Date.now() : false;
  const memberNameById = new Map(members.map((m) => [m.userId, m.displayName] as const));
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
          /*
           * Style commun aux deux rendus d'une option (ouverte ou close) : une
           * ligne pleine largeur avec barre de progression en fond, pas une
           * action compacte. `position: relative` ancre la barre absolue.
           */
          const optionStyle: React.CSSProperties = {
            position: 'relative',
            height: 'auto',
            background: NX.surface,
            border: `0.5px solid ${myVote ? NX.info : NX.border}`,
            borderRadius: NX.radiusSm,
            padding: '12px 14px',
            textAlign: 'left',
            color: NX.fg,
            overflow: 'hidden',
          };

          const optionContent = (
            <>
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
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13, fontWeight: myVote ? 500 : 400 }}>{opt.label}</span>
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
            </>
          );

          /*
           * MAN-246 : un sondage clos rendait ses options en `<button disabled>`
           * à opacité pleine (`disabled:opacity-100`, MAN-112 Task 3).
           * L'intention était bonne — « une option de sondage clos reste un
           * résultat à lire, pas un contrôle délavé » — mais le moyen laissait
           * un contrôle sans aucune affordance d'inertie : rien ne distinguait
           * une option cliquable d'une option morte. On honore l'intention en
           * supprimant le contrôle plutôt qu'en le délavant — le résultat est
           * une ligne non interactive, ni focusable ni cliquable, au rendu
           * visuel identique.
           *
           * `aria-pressed` disparaissant avec le bouton, le vote de
           * l'utilisateur — jusqu'ici porté par la seule couleur de bordure une
           * fois le sondage clos — est repris par un libellé `sr-only`.
           */
          if (closed) {
            return (
              <div key={opt.id} style={optionStyle}>
                {myVote ? <span className="sr-only">Ton vote. </span> : null}
                {optionContent}
              </div>
            );
          }

          return (
            <Button
              key={opt.id}
              variant="ghost"
              onClick={() => onVote(opt.id, myVote)}
              aria-pressed={myVote}
              /*
               * Action principale de PollModal (MAN-112 Task 3). Deux classes
               * de base de `Button` sont neutralisées (overrides résolus par
               * `cn`/tailwind-merge), le reste (relief hover/active, focus
               * clavier) est conservé comme sur les 3 autres modals.
               *  - `whitespace-normal` : un libellé d'option doit pouvoir
               *    passer à la ligne.
               *  - `font-normal` : les noms de votants héritent du poids du
               *    bouton, `font-semibold` les alourdirait.
               * La mise en page `space-between` est portée par le conteneur
               * interne (`width: 100%`), pas par le bouton, donc le
               * `justify-center` des classes de base ne l'affecte pas.
               */
              className="whitespace-normal font-normal"
              style={{ ...optionStyle, cursor: 'pointer' }}
            >
              {optionContent}
            </Button>
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
