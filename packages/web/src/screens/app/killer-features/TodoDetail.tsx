import { useState } from 'react';

import { Avatar, PhIcon } from '@/components/ui';
import { useTodoLists } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { FeatureHeader, PanelEmpty, PanelRoot } from './shared';

interface UiItem {
  id: string;
  text: string;
  done: boolean;
  assigneeId: string | null;
}

export function TodoDetail({ groupId }: { groupId: string }) {
  const todosQ = useTodoLists(groupId);
  const list = todosQ.data?.[0];
  const [items, setItems] = useState<UiItem[]>([]);
  const [draft, setDraft] = useState('');

  // Synchronise l'état local avec la première charge serveur.
  if (list && items.length === 0 && list.items.length > 0) {
    setItems(list.items);
  }

  if (todosQ.isLoading) return <PanelRoot><PanelEmpty title="Chargement…" /></PanelRoot>;
  if (!list) {
    return (
      <PanelRoot>
        <FeatureHeader
          icon="listChecks"
          iconColor={NX.accent}
          iconBg="rgba(192,132,252,0.1)"
          title="Listes"
          subtitle="Aucune liste"
        />
        <PanelEmpty
          title="Pas de liste partagée"
          hint='"Qui amène quoi samedi ?" — crée une liste cochable.'
        />
      </PanelRoot>
    );
  }

  const toggle = (id: string) =>
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const done = items.filter((i) => i.done).length;
  const pct = items.length === 0 ? 0 : (done / items.length) * 100;

  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setItems((cur) => [
      ...cur,
      { id: `tmp-${Date.now()}`, text, done: false, assigneeId: null },
    ]);
    setDraft('');
  };

  return (
    <PanelRoot>
      <FeatureHeader
        icon="listChecks"
        iconColor={NX.accent}
        iconBg="rgba(192,132,252,0.1)"
        title={list.title}
        subtitle={`${done}/${items.length} complétés`}
      />
      <div style={{ padding: '0 20px' }}>
        <div
          style={{
            marginTop: -4,
            height: 4,
            borderRadius: 2,
            background: NX.border,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: NX.primary,
              borderRadius: 2,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: '8px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          overflow: 'auto',
        }}
      >
        {items.map((todo) => (
          <button
            key={todo.id}
            onClick={() => toggle(todo.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 8px',
              cursor: 'pointer',
              borderRadius: NX.radiusXs,
              transition: 'background 0.15s',
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                border: `2px solid ${todo.done ? NX.primary : NX.borderHover}`,
                background: todo.done ? NX.primary : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                flexShrink: 0,
              }}
            >
              {todo.done && <PhIcon name="check" size={12} color="#fff" />}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 13,
                color: todo.done ? NX.fgDim : NX.fg,
                textDecoration: todo.done ? 'line-through' : 'none',
                transition: 'all 0.2s',
              }}
            >
              {todo.text}
            </span>
            {todo.assigneeId ? (
              <Avatar name={todo.assigneeId} size={22} />
            ) : (
              <span
                style={{ fontSize: 10, color: NX.fgGhost, fontStyle: 'italic' }}
              >
                non assigné
              </span>
            )}
          </button>
        ))}
      </div>

      <form
        onSubmit={addItem}
        style={{
          padding: '12px 20px',
          borderTop: `1px solid ${NX.border}`,
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ajouter un item..."
          style={{
            flex: 1,
            background: NX.surface,
            border: `1px solid ${NX.border}`,
            borderRadius: NX.radiusSm,
            padding: '9px 12px',
            fontSize: 13,
            color: NX.fg,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '9px 16px',
            borderRadius: NX.radiusPill,
            background: NX.primary,
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <PhIcon name="plus" size={16} color="#fff" />
        </button>
      </form>
    </PanelRoot>
  );
}
