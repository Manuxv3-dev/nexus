/**
 * Modal Todo List — création / lecture (manipulation des items inline)
 * + suppression de la liste.
 *
 * Cf. J5b #41. Mode :
 *  - 'create' : titre + items optionnels + tags
 *  - 'view'   : titre + checkbox/édition par item + ajout d'item, suppression item
 *
 * Les items se manipulent live : check/uncheck déclenche `useUpdateTodoItem`,
 * ajout/suppression utilise les hooks dédiés. Les autres clients du groupe
 * voient le changement via `todo_item:*` WS events.
 */
import { useMemo, useState } from 'react';

import { Button, PhIcon, useGlassDialogFocusTrap } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useAddTodoItem,
  useCreateTodoList,
  useDeleteTodoItem,
  useDeleteTodoList,
  useGroupMembers,
  useUpdateTodoItem,
  type TodoItemDto,
  type TodoListDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { detailPanelShadow, useCopyLink } from '@/screens/features/shared';

export type TodoListModalMode = 'create' | 'view';

export interface TodoListModalProps {
  mode: TodoListModalMode;
  groupId: string;
  list?: TodoListDto;
  canEdit?: boolean;
  onClose: () => void;
}

interface FormState {
  title: string;
  initialItems: string[];
  tags: string;
}

function initialForm(): FormState {
  return {
    title: '',
    initialItems: [''],
    tags: '',
  };
}

export function TodoListModal({ mode, groupId, list, canEdit, onClose }: TodoListModalProps) {
  const { user } = useAuth();
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];

  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');

  const create = useCreateTodoList();
  const del = useDeleteTodoList();
  const addItem = useAddTodoItem();
  const updateItem = useUpdateTodoItem();
  const deleteItem = useDeleteTodoItem();

  const busy = create.isPending === true || del.isPending === true || addItem.isPending === true;

  // Piège à focus/Escape/retour de focus partagé (MAN-241) — remplace le
  // `useEffect` Escape ad hoc précédent, qui ne respectait pas `busy` (seul
  // le clic overlay le faisait). Chrome custom incompatible avec le rendu
  // de `GlassDialogShell` (cf. sa JSDoc), d'où la mécanique seule.
  const { titleId, containerRef } = useGlassDialogFocusTrap({ onClose, closeDisabled: busy });

  async function handleSave() {
    setError(null);
    const title = form.title.trim();
    if (!title) return setError('Titre requis');
    const items = form.initialItems
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await create.mutateAsync({
        groupId,
        title,
        initialItems: items,
        tags,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création');
    }
  }

  async function handleDelete() {
    if (!list) return;
    if (!window.confirm(`Supprimer la liste "${list.title}" ?`)) return;
    try {
      await del.mutateAsync({ listId: list.id, groupId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression');
    }
  }

  async function handleAddItem() {
    if (!list) return;
    const text = newItemText.trim();
    if (!text) return;
    setNewItemText('');
    try {
      await addItem.mutateAsync({ listId: list.id, groupId, text });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur ajout');
    }
  }

  async function handleToggleItem(item: TodoItemDto) {
    if (!list) return;
    try {
      await updateItem.mutateAsync({
        itemId: item.id,
        listId: list.id,
        groupId,
        done: !item.done,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleDeleteItem(item: TodoItemDto) {
    if (!list) return;
    try {
      await deleteItem.mutateAsync({ itemId: item.id, listId: list.id, groupId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleAssignItem(item: TodoItemDto, assigneeId: string | null) {
    if (!list) return;
    try {
      await updateItem.mutateAsync({
        itemId: item.id,
        listId: list.id,
        groupId,
        assigneeId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  const copyLink = useCopyLink({ slug: list?.slug, kind: 't' });

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
              background: NX.featTodoBg,
              color: NX.featTodo,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhIcon name="checkSquare" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id={titleId} style={{ fontSize: 15, fontWeight: 500, color: NX.fg }}>
              {mode === 'create' ? 'Nouvelle liste' : (list?.title ?? 'Liste')}
            </div>
            {mode === 'view' && list ? <ListProgress items={list.items} /> : null}
          </div>
          <button type="button" onClick={onClose} disabled={busy} style={closeBtn}>
            <PhIcon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', overflow: 'auto', flex: 1 }}>
          {mode === 'create' ? (
            <FormBody form={form} setForm={setForm} />
          ) : list ? (
            <ViewBody
              list={list}
              members={members}
              userId={user?.id}
              newItemText={newItemText}
              setNewItemText={setNewItemText}
              onAddItem={() => void handleAddItem()}
              onToggleItem={(item) => void handleToggleItem(item)}
              onDeleteItem={(item) => void handleDeleteItem(item)}
              onAssignItem={(item, assigneeId) => void handleAssignItem(item, assigneeId)}
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
          {mode === 'view' && list ? (
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

// ─────────────────────────── List progress ─────────────────────────────

function ListProgress({ items }: { items: TodoItemDto[] }) {
  const done = items.filter((i) => i.done).length;
  const pct = items.length === 0 ? 0 : Math.round((done / items.length) * 100);
  return (
    <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>
      {done} / {items.length} ({pct}%)
    </div>
  );
}

// ─────────────────────────── Form ──────────────────────────────────────

function FormBody({ form, setForm }: { form: FormState; setForm: (v: FormState) => void }) {
  function setItem(idx: number, value: string) {
    const next = [...form.initialItems];
    next[idx] = value;
    setForm({ ...form, initialItems: next });
  }
  function addItem() {
    if (form.initialItems.length >= 50) return;
    setForm({ ...form, initialItems: [...form.initialItems, ''] });
  }
  function removeItem(idx: number) {
    setForm({ ...form, initialItems: form.initialItems.filter((_, i) => i !== idx) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Titre">
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Courses pour la soirée"
          style={inputStyle}
          autoFocus
        />
      </Field>
      <Field label="Items initiaux (optionnels)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {form.initialItems.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={it}
                onChange={(e) => setItem(i, e.target.value)}
                placeholder={`Item ${i + 1}`}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => removeItem(i)}
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
            </div>
          ))}
          {form.initialItems.length < 50 ? (
            <button
              type="button"
              onClick={addItem}
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
              + Ajouter un item
            </button>
          ) : null}
        </div>
      </Field>
      <Field label="Tags (séparés par virgule)">
        <input
          type="text"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="courses, soiree"
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
  list,
  members,
  userId,
  newItemText,
  setNewItemText,
  onAddItem,
  onToggleItem,
  onDeleteItem,
  onAssignItem,
}: {
  list: TodoListDto;
  members: { userId: string; displayName: string }[];
  userId: string | undefined;
  newItemText: string;
  setNewItemText: (v: string) => void;
  onAddItem: () => void;
  onToggleItem: (item: TodoItemDto) => void;
  onDeleteItem: (item: TodoItemDto) => void;
  onAssignItem: (item: TodoItemDto, assigneeId: string | null) => void;
}) {
  const memberNameById = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName])),
    [members],
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {list.tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {list.tags.map((t) => (
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {list.items.length === 0 ? (
          <div style={{ fontSize: 12, color: NX.fgDim, fontStyle: 'italic', padding: '8px 0' }}>
            Liste vide. Ajoute le premier item ci-dessous.
          </div>
        ) : null}
        {list.items.map((item) => {
          const assigneeName = item.assigneeId
            ? (memberNameById.get(item.assigneeId) ?? item.assigneeId.slice(0, 8))
            : null;
          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                background: item.done ? `${NX.success}10` : NX.surface,
                borderRadius: NX.radiusSm,
                border: `0.5px solid ${item.done ? `${NX.success}55` : NX.border}`,
              }}
            >
              {/* Action principale de TodoListModal (MAN-112 Task 3) : `Button`
                  partagé (variant="icon", relief hover/active, focus clavier)
                  redimensionné en checkbox compacte 22×22 via `style` — les
                  couleurs par état (coché/non coché) restent pilotées par
                  `style`, qui gagne toujours sur les classes Tailwind du
                  variant. */}
              <Button
                variant="icon"
                size="icon"
                onClick={() => onToggleItem(item)}
                aria-label={`${item.done ? 'Décocher' : 'Cocher'} ${item.text}`}
                aria-pressed={item.done}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `1.5px solid ${item.done ? NX.success : NX.borderHover}`,
                  background: item.done ? NX.success : 'transparent',
                  flexShrink: 0,
                }}
              >
                {item.done ? <PhIcon name="check" size={12} color="#0b1a14" /> : null}
              </Button>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: item.done ? NX.fgDim : NX.fg,
                  textDecoration: item.done ? 'line-through' : 'none',
                }}
              >
                {item.text}
              </span>
              <select
                value={item.assigneeId ?? ''}
                onChange={(e) => onAssignItem(item, e.target.value || null)}
                style={{
                  background: 'transparent',
                  color: assigneeName ? NX.fg : NX.fgDim,
                  border: 'none',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: NX.radiusSm,
                }}
              >
                <option value="">Personne</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onDeleteItem(item)}
                style={{
                  background: 'transparent',
                  color: NX.fgDim,
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  flexShrink: 0,
                }}
                aria-label="Supprimer"
              >
                <PhIcon name="x" size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAddItem();
          }}
          placeholder={`Ajouter à la liste${userId ? '' : '…'}`}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          type="button"
          onClick={onAddItem}
          disabled={!newItemText.trim()}
          style={{
            padding: '8px 12px',
            background: NX.success,
            color: '#0b1a14',
            border: 'none',
            borderRadius: NX.radiusSm,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: newItemText.trim() ? 1 : 0.5,
          }}
        >
          + Ajouter
        </button>
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
