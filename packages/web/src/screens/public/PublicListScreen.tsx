/**
 * Page publique `/l/:slug` — alias de la page Todo (cf. ADR-010 : `/t/:slug`
 * pour les todos d'événement, `/l/:slug` pour les listes courses partagées).
 *
 * Pour le V1 stub, les deux backbones DB seront identiques. On rendra le
 * même composant en attendant que J5 différencie sémantiquement.
 */
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';

import { Avatar, PhIcon } from '@/components/ui';
import { NX } from '@/lib/tokens';

import { PublicCTAFooter, PublicHero, PublicShell } from './PublicShell';
import { usePublicTodo } from './hooks';

export function PublicListScreen() {
  const { slug } = useParams({ from: '/l/$slug' });
  const todoQ = usePublicTodo(slug);
  const [items, setItems] = useState<{ id: string; text: string; done: boolean; assigneeId: string | null }[]>([]);

  if (todoQ.data && items.length === 0 && todoQ.data.items.length > 0) {
    setItems(todoQ.data.items);
  }

  if (todoQ.isLoading)
    return (
      <PublicShell>
        <div style={{ padding: 80, textAlign: 'center', color: NX.fgDim }}>Chargement…</div>
      </PublicShell>
    );
  if (!todoQ.data)
    return (
      <PublicShell>
        <div style={{ padding: 80, textAlign: 'center', color: NX.fg }}>Liste introuvable</div>
      </PublicShell>
    );

  const list = todoQ.data;
  const done = items.filter((i) => i.done).length;

  return (
    <PublicShell>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 40px' }}>
        <PublicHero
          icon="listChecks"
          iconColor={NX.accent}
          iconBg="rgba(192,132,252,0.1)"
          type="Liste partagée"
          groupName="Groupe Nexus"
          title={list.title}
          gradientFrom="rgba(192,132,252,0.12)"
          gradientTo="rgba(124,92,252,0.08)"
          meta={`${done}/${items.length} cochés`}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((todo) => (
            <button
              key={todo.id}
              onClick={() => setItems((cur) => cur.map((it) => (it.id === todo.id ? { ...it, done: !it.done } : it)))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: NX.elevated,
                borderRadius: NX.radiusSm,
                border: `1px solid ${NX.border}`,
                cursor: 'pointer',
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
                  flexShrink: 0,
                }}
              >
                {todo.done && <PhIcon name="check" size={12} color="#fff" />}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 14,
                  color: todo.done ? NX.fgDim : NX.fg,
                  textDecoration: todo.done ? 'line-through' : 'none',
                }}
              >
                {todo.text}
              </span>
              {todo.assigneeId && <Avatar name={todo.assigneeId} size={22} />}
            </button>
          ))}
        </div>
        <PublicCTAFooter />
      </div>
    </PublicShell>
  );
}
