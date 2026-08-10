/**
 * Modal Event — création / lecture / édition + flow RSVP.
 *
 * Cf. J5b #38. Mode :
 *  - 'create' : form vide, save → POST events
 *  - 'view'   : lecture + boutons RSVP + "Modifier" si je suis créateur ou
 *               admin/owner du groupe + "Copier le lien"
 *  - 'edit'   : form pré-rempli, save → PATCH events
 */
import { useState } from 'react';

import { Button, PhIcon, useGlassDialogFocusTrap } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useCreateEvent,
  useDeleteEvent,
  useEventRsvp,
  useGroupMembers,
  useUpdateEvent,
  type EventDto,
  type RsvpValue,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { detailPanelShadow, useCopyLink } from '@/screens/features/shared';

export type EventModalMode = 'create' | 'view' | 'edit';

export interface EventModalProps {
  mode: EventModalMode;
  groupId: string;
  /** Présent en mode view/edit. */
  event?: EventDto;
  /** True si l'utilisateur courant peut éditer/supprimer. */
  canEdit?: boolean;
  onClose: () => void;
  /** Bascule de view → edit. */
  onSwitchToEdit?: () => void;
}

interface FormState {
  title: string;
  description: string;
  startsAt: string; // datetime-local
  location: string;
  tags: string;
}

function initialForm(event?: EventDto): FormState {
  if (!event) {
    // Default : aujourd'hui + 1h, format datetime-local YYYY-MM-DDTHH:mm
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return {
      title: '',
      description: '',
      startsAt: toLocalInput(d),
      location: '',
      tags: '',
    };
  }
  return {
    title: event.title,
    description: event.description ?? '',
    startsAt: toLocalInput(new Date(event.startsAt)),
    location: event.location ?? '',
    tags: event.tags.join(', '),
  };
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventModal({
  mode,
  groupId,
  event,
  canEdit,
  onClose,
  onSwitchToEdit,
}: EventModalProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(event));
  const [error, setError] = useState<string | null>(null);
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const del = useDeleteEvent();
  const rsvp = useEventRsvp();
  const { user } = useAuth();
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];

  const isFormMode = mode === 'create' || mode === 'edit';
  const busy = create.isPending === true || update.isPending === true || del.isPending === true;

  // Piège à focus/Escape/retour de focus partagé (MAN-241) — remplace le
  // `useEffect` Escape ad hoc précédent, qui ne respectait pas `busy` (seul
  // le clic overlay le faisait). Chrome custom (header icône, corps
  // scrollable indépendant, footer épinglé) incompatible avec le rendu de
  // `GlassDialogShell` — cf. sa JSDoc — d'où la mécanique seule, pas le
  // composant.
  const { titleId, containerRef } = useGlassDialogFocusTrap({ onClose, closeDisabled: busy });

  async function handleSave() {
    setError(null);
    if (!form.title.trim()) {
      setError('Le titre est requis');
      return;
    }
    const startsAtDate = new Date(form.startsAt);
    if (Number.isNaN(startsAtDate.getTime())) {
      setError('Date invalide');
      return;
    }
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      if (mode === 'create') {
        await create.mutateAsync({
          groupId,
          title: form.title.trim(),
          description: form.description.trim() || null,
          startsAt: startsAtDate.toISOString(),
          location: form.location.trim() || null,
          tags,
        });
      } else if (event) {
        await update.mutateAsync({
          eventId: event.id,
          title: form.title.trim(),
          description: form.description.trim() || null,
          startsAt: startsAtDate.toISOString(),
          location: form.location.trim() || null,
          tags,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  }

  async function handleDelete() {
    if (!event) return;
    if (!window.confirm(`Supprimer définitivement "${event.title}" ?`)) return;
    try {
      await del.mutateAsync({ eventId: event.id, groupId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression');
    }
  }

  async function handleRsvp(value: RsvpValue | null) {
    if (!event) return;
    try {
      await rsvp.mutateAsync({ eventId: event.id, value });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur RSVP');
    }
  }

  const copyLink = useCopyLink({ slug: event?.slug, kind: 'e' });

  const myRsvp =
    event && user ? (event.rsvps.find((r) => r.userId === user.id)?.value ?? null) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={busy ? undefined : onClose}
      style={{
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
      }}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
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
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: `0.5px solid ${NX.border}`,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: NX.featEventsBg,
              color: NX.featEvents,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhIcon name="calendarBlank" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id={titleId} style={{ fontSize: 15, fontWeight: 500, color: NX.fg }}>
              {mode === 'create'
                ? 'Nouvel événement'
                : mode === 'edit'
                  ? 'Modifier l’événement'
                  : (event?.title ?? 'Événement')}
            </div>
            {mode === 'view' && event ? (
              <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>
                {new Date(event.startsAt).toLocaleString('fr-FR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer"
            style={{
              background: 'transparent',
              border: 'none',
              color: NX.fgDim,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <PhIcon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', overflow: 'auto', flex: 1 }}>
          {isFormMode ? (
            <FormBody form={form} setForm={setForm} />
          ) : event ? (
            <ViewBody
              event={event}
              myRsvp={myRsvp}
              members={members}
              onRsvp={(v) => void handleRsvp(v)}
              rsvpBusy={rsvp.isPending}
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
        <div
          style={{
            padding: '14px 20px',
            display: 'flex',
            gap: 8,
            borderTop: `0.5px solid ${NX.border}`,
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          {mode === 'view' && event ? (
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
                <>
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={busy}
                    style={{ ...chipBtn, color: NX.error }}
                  >
                    Supprimer
                  </button>
                  <Button onClick={onSwitchToEdit ?? (() => undefined)} variant="ghost" size="sm">
                    Modifier
                  </Button>
                </>
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
                {busy ? 'Enregistrement…' : mode === 'create' ? 'Créer' : 'Enregistrer'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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

// ─────────────────────────── Form ───────────────────────────────────────

function FormBody({ form, setForm }: { form: FormState; setForm: (v: FormState) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Titre">
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Soirée chez Léa"
          style={inputStyle}
          autoFocus
        />
      </Field>
      <Field label="Date et heure">
        <input
          type="datetime-local"
          value={form.startsAt}
          onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          style={inputStyle}
        />
      </Field>
      <Field label="Lieu (optionnel)">
        <input
          type="text"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          placeholder="42 rue de la Roquette, Paris"
          style={inputStyle}
        />
      </Field>
      <Field label="Description (optionnelle)">
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
        />
      </Field>
      <Field label="Tags (séparés par virgule)">
        <input
          type="text"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="ski, week-end"
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

const inputStyle: React.CSSProperties = {
  background: NX.surface,
  border: `0.5px solid ${NX.border}`,
  color: NX.fg,
  padding: '8px 12px',
  borderRadius: NX.radiusSm,
  fontSize: 13,
  outline: 'none',
};

// ─────────────────────────── View ───────────────────────────────────────

function ViewBody({
  event,
  myRsvp,
  members,
  onRsvp,
  rsvpBusy,
}: {
  event: EventDto;
  myRsvp: RsvpValue | null;
  members: { userId: string; displayName: string }[];
  onRsvp: (v: RsvpValue | null) => void;
  rsvpBusy: boolean;
}) {
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const r of event.rsvps) counts[r.value] += 1;

  const memberNameById = new Map(members.map((m) => [m.userId, m.displayName] as const));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {event.location ? <Row icon="mapPin" text={event.location} /> : null}
      {event.description ? (
        <div style={{ fontSize: 13, color: NX.fg, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {event.description}
        </div>
      ) : null}
      {event.tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {event.tags.map((t) => (
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

      {/* RSVP buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <div style={{ fontSize: 12, color: NX.fgMuted }}>Ta réponse</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <RsvpButton
            label="Oui"
            color={NX.success}
            active={myRsvp === 'yes'}
            onClick={() => onRsvp('yes')}
            disabled={rsvpBusy}
          />
          <RsvpButton
            label="Peut-être"
            color={NX.warning}
            active={myRsvp === 'maybe'}
            onClick={() => onRsvp('maybe')}
            disabled={rsvpBusy}
          />
          <RsvpButton
            label="Non"
            color={NX.error}
            active={myRsvp === 'no'}
            onClick={() => onRsvp('no')}
            disabled={rsvpBusy}
          />
          {myRsvp ? (
            <button
              type="button"
              onClick={() => onRsvp(null)}
              disabled={rsvpBusy}
              style={{
                background: 'transparent',
                border: 'none',
                color: NX.fgDim,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Effacer
            </button>
          ) : null}
        </div>
      </div>

      {/* Liste des réponses */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, color: NX.fgMuted }}>
          Participants · {counts.yes} oui · {counts.maybe} peut-être · {counts.no} non
        </div>
        {event.rsvps.length === 0 ? (
          <div style={{ fontSize: 12, color: NX.fgDim, fontStyle: 'italic' }}>
            Personne n'a encore répondu.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {event.rsvps.map((r) => (
              <div
                key={r.userId}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background:
                      r.value === 'yes' ? NX.success : r.value === 'maybe' ? NX.warning : NX.error,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: NX.fg }}>
                  {memberNameById.get(r.userId) ?? r.userId.slice(0, 8)}
                </span>
                <span style={{ color: NX.fgDim }}>· {r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ icon, text }: { icon: 'mapPin' | 'clock'; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: NX.fgMuted }}>
      <PhIcon name={icon} size={14} />
      {text}
    </div>
  );
}

/**
 * Action principale de EventModal (MAN-112 Task 3) : passe par le `Button`
 * partagé (relief hover/active, focus clavier cohérent) plutôt qu'un
 * `<button>` brut. Les couleurs par état (oui/peut-être/non) restent
 * pilotées par `style` — `Button` les laisse passer intactes (le style
 * inline gagne toujours sur ses classes Tailwind de fond/bordure).
 */
function RsvpButton({
  label,
  color,
  active,
  onClick,
  disabled,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        height: 'auto',
        padding: '6px 14px',
        borderRadius: NX.radiusPill,
        background: active ? color : 'transparent',
        color: active ? '#10231a' : color,
        border: `0.5px solid ${color}`,
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </Button>
  );
}
