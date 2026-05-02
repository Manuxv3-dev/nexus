/**
 * Dashboard Todos — vue panel pour `pane === 'todo'`. Cf. J5b #41.
 *
 * Layout :
 *  - Filtres : Actives / Mes tâches / Toutes.
 *  - Grid de cards listes avec progress bar + petit aperçu d'items.
 *  - Modal de création + modal de view au clic sur une card.
 */
import { useState } from 'react';

import { PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useGroups, useTodoLists, type TodoListDto } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';
import { TodoListModal } from './todos/TodoListModal';

type Filter = 'active' | 'mine' | 'all';

function isListActive(list: TodoListDto): boolean {
  return list.items.some((i) => !i.done);
}

export function TodosDashboard() {
  const { user } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  const activeGroupId = groups[0]?.id;

  const [filter, setFilter] = useState<Filter>('active');
  // Stocker l'ID seulement (pas l'objet figé) pour que la modal suive
  // automatiquement les re-fetch de TanStack Query après check/add/delete.
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'view'; listId: string } | null
  >(null);

  const listsQ = useTodoLists(activeGroupId);
  const allLists = listsQ.data ?? [];
  const openList = modal?.mode === 'view' ? allLists.find((l) => l.id === modal.listId) : undefined;

  const filteredLists =
    filter === 'active'
      ? allLists.filter(isListActive)
      : filter === 'mine' && user
        ? allLists.filter((l) =>
            l.items.some((i) => i.assigneeId === user.id && !i.done),
          )
        : allLists;

  return (
    <FeatureShell
      iconName="listChecks"
      iconColor={NX.success}
      iconBg={NX.successBg}
      title="Listes & tâches"
      subtitle={`${allLists.length} liste${allLists.length > 1 ? 's' : ''}`}
      primaryAction={{
        label: 'Nouvelle liste',
        onClick: () => activeGroupId && setModal({ mode: 'create' }),
      }}
      filters={
        <>
          <FilterChip
            label="Actives"
            active={filter === 'active'}
            onClick={() => setFilter('active')}
          />
          <FilterChip
            label="Mes tâches"
            active={filter === 'mine'}
            onClick={() => setFilter('mine')}
          />
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
      ) : listsQ.isLoading ? (
        <div style={{ color: NX.fgMuted, padding: 24 }}>Chargement…</div>
      ) : filteredLists.length === 0 ? (
        <Placeholder
          title={
            filter === 'active'
              ? 'Aucune liste active'
              : filter === 'mine'
                ? 'Aucune tâche assignée à toi'
                : 'Pas encore de listes'
          }
          description="Crée la première avec le bouton « Nouvelle liste »."
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 12,
          }}
        >
          {filteredLists.map((l) => (
            <TodoListCard
              key={l.id}
              list={l}
              userId={user?.id}
              onOpen={() => setModal({ mode: 'view', listId: l.id })}
            />
          ))}
        </div>
      )}

      {modal && activeGroupId ? (
        modal.mode === 'create' ? (
          <TodoListModal
            mode="create"
            groupId={activeGroupId}
            onClose={() => setModal(null)}
          />
        ) : openList ? (
          <TodoListModal
            mode="view"
            groupId={activeGroupId}
            list={openList}
            canEdit={user ? openList.createdBy === user.id : false}
            onClose={() => setModal(null)}
          />
        ) : null
      ) : null}
    </FeatureShell>
  );
}

// ─────────────────────────── Card ───────────────────────────────────────

function TodoListCard({
  list,
  userId,
  onOpen,
}: {
  list: TodoListDto;
  userId: string | undefined;
  onOpen: () => void;
}) {
  const done = list.items.filter((i) => i.done).length;
  const total = list.items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const myAssigned = userId
    ? list.items.filter((i) => i.assigneeId === userId && !i.done).length
    : 0;
  const preview = list.items.slice(0, 3);

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        background: NX.surface,
        border: `0.5px solid ${myAssigned > 0 ? NX.warning : NX.border}`,
        borderRadius: NX.radius,
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
          {list.title}
        </div>
        {myAssigned > 0 ? (
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              background: NX.warningBg,
              color: NX.warning,
              borderRadius: NX.radiusPill,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {myAssigned} pour toi
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: NX.fgDim }}>
        <span>
          {done} / {total} ({pct}%)
        </span>
        {pct === 100 && total > 0 ? (
          <>
            <span>·</span>
            <span style={{ color: NX.success }}>
              <PhIcon name="check" size={11} /> terminée
            </span>
          </>
        ) : null}
      </div>

      <div style={{ height: 4, background: NX.elevated, borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: pct === 100 ? NX.success : NX.warning,
            transition: 'width 0.3s',
          }}
        />
      </div>

      {preview.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {preview.map((item) => (
            <div
              key={item.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
            >
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  border: `1.5px solid ${item.done ? NX.success : NX.borderHover}`,
                  background: item.done ? NX.success : 'transparent',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: item.done ? NX.fgDim : NX.fgMuted,
                  textDecoration: item.done ? 'line-through' : 'none',
                }}
              >
                {item.text}
              </span>
            </div>
          ))}
          {total > 3 ? (
            <div style={{ fontSize: 10, color: NX.fgDim, marginTop: 2 }}>
              +{total - 3} autre{total - 3 > 1 ? 's' : ''}
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: NX.fgDim, fontStyle: 'italic' }}>Liste vide</div>
      )}
    </button>
  );
}
