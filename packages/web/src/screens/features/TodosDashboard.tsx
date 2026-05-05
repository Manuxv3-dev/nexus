/**
 * Dashboard Todos — refonte structurelle (cf. ADR-021 + bundle HTML
 * 12-todo-dashboard.html, J5c).
 *
 * Layout interne au panel main de l'AppShell :
 *  - Main (1fr) : Hero "mes tâches" (items assignés à moi non-done, avec
 *    quick-check inline), Stats row, Grid de cards listes.
 *  - Right rail (340px ≥1280px) : items checkés récents + quick create.
 */
import { useEffect, useMemo, useState } from 'react';

import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useGroupMembers,
  useGroups,
  useTodoLists,
  useUpdateTodoItem,
  type TodoItemDto,
  type TodoListDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';
import { TodoListModal } from './todos/TodoListModal';

type Filter = 'active' | 'mine' | 'all';

function isListActive(list: TodoListDto): boolean {
  return list.items.some((i) => !i.done);
}

export function TodosDashboard({
  groupId,
  openItemId,
  onConsumeOpen,
}: {
  groupId?: string;
  openItemId?: string | null;
  onConsumeOpen?: () => void;
} = {}) {
  const { user } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  // Fix 2026-05-05 : on respecte le groupe actif passé par AppShell.
  const activeGroupId = groupId ?? groups[0]?.id;

  const [filter, setFilter] = useState<Filter>('active');
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'view'; listId: string } | null>(
    null,
  );

  const listsQ = useTodoLists(activeGroupId);
  const allLists = listsQ.data ?? [];

  // Deep-link depuis une notification : openItemId = itemId, on cherche la
  // liste qui le contient pour ouvrir sa modal. Attend allLists chargé.
  // V1.1 prévoir un endpoint GET /todo-items/:id qui retourne le listId
  // pour traiter le cas où la liste parente n'est pas dans le group courant.
  useEffect(() => {
    if (!openItemId) return;
    if (listsQ.isLoading) return;
    const parentList = allLists.find((l) => l.items.some((i) => i.id === openItemId));
    if (parentList) {
      setModal({ mode: 'view', listId: parentList.id });
      onConsumeOpen?.();
    } else if (allLists.length > 0) {
      // Lists chargées mais l'item n'est pas dedans → consomme quand même
      // pour ne pas re-trigger en boucle. L'user verra le dashboard sans
      // modal — V1.1 fallback fetch direct.
      onConsumeOpen?.();
    }
  }, [openItemId, allLists, listsQ.isLoading, onConsumeOpen]);
  const openList = modal?.mode === 'view' ? allLists.find((l) => l.id === modal.listId) : undefined;

  const filteredLists =
    filter === 'active'
      ? allLists.filter(isListActive)
      : filter === 'mine' && user
        ? allLists.filter((l) => l.items.some((i) => i.assigneeId === user.id && !i.done))
        : allLists;

  // Mes items à faire (cross-listes)
  const myPendingItems = useMemo(() => {
    if (!user) return [];
    const items: { item: TodoItemDto; listTitle: string; listId: string }[] = [];
    for (const l of allLists) {
      for (const i of l.items) {
        if (i.assigneeId === user.id && !i.done) {
          items.push({ item: i, listTitle: l.title, listId: l.id });
        }
      }
    }
    return items;
  }, [allLists, user]);

  return (
    <FeatureShell
      iconName="listChecks"
      iconColor={NX.featTodo}
      iconBg={NX.featTodoBg}
      title="Listes & tâches"
      subtitle={`${allLists.length} liste${allLists.length > 1 ? 's' : ''}`}
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
      ) : (
        <div style={dashLayout}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {myPendingItems.length > 0 && user ? (
              <MyTasksHero
                items={myPendingItems}
                groupId={activeGroupId}
                onOpen={(listId) => setModal({ mode: 'view', listId })}
              />
            ) : null}

            <TodosStatsRow allLists={allLists} userId={user?.id} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <SectionHeader
                title={
                  filter === 'active'
                    ? 'Listes actives'
                    : filter === 'mine'
                      ? 'Listes avec tâches pour toi'
                      : 'Toutes les listes'
                }
                count={filteredLists.length}
              />
              {filteredLists.length === 0 ? (
                <Placeholder
                  title={
                    filter === 'active'
                      ? 'Aucune liste active'
                      : filter === 'mine'
                        ? 'Aucune tâche assignée à toi'
                        : 'Pas encore de listes'
                  }
                  description="Crée la première avec « Nouvelle liste »."
                />
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
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
            </div>
          </div>

          {/* RIGHT RAIL */}
          <div style={rightRailStyle}>
            <QuickCreate onCreate={() => activeGroupId && setModal({ mode: 'create' })} />
            <TodosActivityFeed lists={allLists} userId={user?.id} groupId={activeGroupId} />
          </div>
        </div>
      )}

      {modal && activeGroupId ? (
        modal.mode === 'create' ? (
          <TodoListModal mode="create" groupId={activeGroupId} onClose={() => setModal(null)} />
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

// ─────────────────────────── Layout ────────────────────────────────────

const dashLayout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 340px',
  gap: 20,
  alignItems: 'start',
};

const rightRailStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  position: 'sticky',
  top: 16,
};

// ─────────────────────────── Hero (my tasks) ───────────────────────────

function MyTasksHero({
  items,
  groupId,
  onOpen,
}: {
  items: { item: TodoItemDto; listTitle: string; listId: string }[];
  groupId: string;
  onOpen: (listId: string) => void;
}) {
  const updateItem = useUpdateTodoItem();
  const top5 = items.slice(0, 5);
  // Ne pas afficher l'argument groupId pour l'instant (juste pour cohérence avec ExpenseCard).
  void groupId;

  const handleToggle = async (item: TodoItemDto, listId: string) => {
    try {
      await updateItem.mutateAsync({
        itemId: item.id,
        listId,
        groupId,
        done: true,
      });
    } catch (err) {
      console.error('[todos] toggle failed', err);
    }
  };

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${NX.featTodoBg} 0%, transparent 80%), ${NX.surface}`,
        border: `0.5px solid ${NX.featTodo}33`,
        borderRadius: NX.radiusXl,
        padding: 24,
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: NX.featTodo,
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Tes tâches en cours · {items.length}
      </div>

      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: NX.fg,
          margin: 0,
          marginBottom: 16,
          lineHeight: 1.2,
        }}
      >
        {items.length === 1 ? '1 chose à cocher.' : `${items.length} choses à cocher.`}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {top5.map(({ item, listTitle, listId }) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              background: NX.elevated,
              border: `0.5px solid ${NX.border}`,
              borderRadius: NX.radiusMd,
            }}
          >
            <button
              type="button"
              onClick={() => void handleToggle(item, listId)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                border: `1.5px solid ${NX.featTodo}`,
                background: 'transparent',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Cocher"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: NX.fg, lineHeight: 1.3 }}>{item.text}</div>
              <button
                type="button"
                onClick={() => onOpen(listId)}
                style={{
                  fontSize: 11,
                  color: NX.fgDim,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {listTitle} →
              </button>
            </div>
          </div>
        ))}
        {items.length > 5 ? (
          <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 4 }}>
            +{items.length - 5} autre{items.length - 5 > 1 ? 's' : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────── Stats ─────────────────────────────────────

function TodosStatsRow({
  allLists,
  userId,
}: {
  allLists: TodoListDto[];
  userId: string | undefined;
}) {
  const activeLists = allLists.filter(isListActive).length;
  const totalItems = allLists.reduce((s, l) => s + l.items.length, 0);
  const doneItems = allLists.reduce((s, l) => s + l.items.filter((i) => i.done).length, 0);
  const myPending = userId
    ? allLists.reduce(
        (s, l) => s + l.items.filter((i) => i.assigneeId === userId && !i.done).length,
        0,
      )
    : 0;
  const donePct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      <StatCard icon="listChecks" label="Actives" value={activeLists.toString()} unit="listes" />
      <StatCard icon="hourglass" label="Mes tâches" value={myPending.toString()} unit="" />
      <StatCard
        icon="checks"
        label="Avancement"
        value={donePct !== null ? donePct.toString() : '—'}
        unit={donePct !== null ? '%' : ''}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  unit,
}: {
  icon: 'listChecks' | 'hourglass' | 'checks';
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: NX.fgMuted,
          fontWeight: 500,
          marginBottom: 6,
        }}
      >
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {label}
      </div>
      <div
        style={{ fontSize: 22, fontWeight: 700, color: NX.fg, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
        <span style={{ fontSize: 11, color: NX.fgDim, fontWeight: 500, marginLeft: 4 }}>
          {unit}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────── Section header ────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
      <h3
        style={{ fontSize: 13, fontWeight: 600, color: NX.fg, margin: 0, letterSpacing: '-0.01em' }}
      >
        {title}
      </h3>
      <span style={{ fontSize: 11, color: NX.fgDim }}>{count}</span>
    </div>
  );
}

// ─────────────────────────── Right rail ────────────────────────────────

function TodosActivityFeed({
  lists,
  userId,
  groupId,
}: {
  lists: TodoListDto[];
  userId: string | undefined;
  groupId: string | undefined;
}) {
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];
  const nameById = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName])), [members]);

  // Activity = items done récents (proxy : items dont updatedAt récent + done)
  const activity = useMemo(() => {
    const items: { item: TodoItemDto; listTitle: string }[] = [];
    for (const l of lists) {
      for (const i of l.items) {
        if (i.done) {
          items.push({ item: i, listTitle: l.title });
        }
      }
    }
    items.sort(
      (a, b) => new Date(b.item.updatedAt).getTime() - new Date(a.item.updatedAt).getTime(),
    );
    return items.slice(0, 5);
  }, [lists]);

  const displayNameOf = (uid: string) =>
    uid === userId ? 'Toi' : (nameById.get(uid) ?? uid.slice(0, 6));

  return (
    <RailBlock icon="clock" title="Cochés récents">
      {activity.length === 0 ? (
        <div style={{ fontSize: 12, color: NX.fgDim }}>Aucun item coché.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activity.map(({ item, listTitle }) => {
            const name = item.assigneeId ? displayNameOf(item.assigneeId) : "Quelqu'un";
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={name} size={22} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <span style={{ color: NX.fg, fontWeight: 500 }}>{name}</span>
                  <span style={{ color: NX.fgMuted }}> a coché </span>
                  <span style={{ color: NX.featTodo, fontWeight: 500 }}>« {item.text} »</span>
                  <div
                    style={{
                      color: NX.fgDim,
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {listTitle}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </RailBlock>
  );
}

function QuickCreate({ onCreate }: { onCreate: () => void }) {
  return (
    <RailBlock icon="plusCircle" title="Créer rapidement">
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 12px',
          background: NX.featTodoBg,
          border: `0.5px dashed ${NX.featTodo}55`,
          borderRadius: NX.radiusMd,
          color: NX.featTodo,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <PhIcon name="plus" size={16} color={NX.featTodo} />
        Nouvelle liste
      </button>
      <div style={{ fontSize: 11, color: NX.fgGhost, marginTop: 8, lineHeight: 1.4 }}>
        Courses, qui amène quoi, prépa week-end. Coche en un tap.
      </div>
    </RailBlock>
  );
}

function RailBlock({
  icon,
  title,
  children,
}: {
  icon: 'clock' | 'plusCircle';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: NX.fgMuted,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
        }}
      >
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {title}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────── Card ──────────────────────────────────────

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
        border: `0.5px solid ${myAssigned > 0 ? `${NX.featTodo}55` : NX.border}`,
        borderRadius: NX.radiusLg,
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
              padding: '2px 7px',
              background: NX.featTodoBg,
              color: NX.featTodo,
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
            <span style={{ color: NX.featTodo }}>
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
            background: NX.featTodo,
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
                  border: `1.5px solid ${item.done ? NX.featTodo : NX.borderHover}`,
                  background: item.done ? NX.featTodo : 'transparent',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: item.done ? NX.fgDim : NX.fg,
                  textDecoration: item.done ? 'line-through' : 'none',
                }}
              >
                {item.text}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </button>
  );
}
