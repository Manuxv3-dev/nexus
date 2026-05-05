/**
 * Body commun aux pages publiques `/t/:slug` et `/l/:slug`. Cf. J5b #41.
 *
 *  - Lecture : visible par tous (mise à jour live via WS).
 *  - Check/uncheck : seulement si user authentifié ET membre du groupe.
 *    Sinon affichage read-only + CTA « Connecte-toi ».
 *
 * Le `kind` ne change que les tags OG (titre / type) et l'icône.
 */
import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useGroups, useUpdateTodoItem } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { OgMeta } from './og-meta';
import { PublicCTAFooter, PublicHero, PublicShell } from './PublicShell';
import { usePublicTodo } from './hooks';

export interface PublicTodoBodyProps {
  slug: string;
  kind: 'todo' | 'list';
}

export function PublicTodoBody({ slug, kind }: PublicTodoBodyProps) {
  const todoQ = usePublicTodo(slug);
  const user = useAuth((s) => s.user);
  const authInitializing = useAuth((s) => s.initializing);
  const groupsQ = useGroups();
  const updateItem = useUpdateTodoItem();

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
  const authReady = !authInitializing;
  const membershipResolved = authReady && (!user || groupsQ.isSuccess);
  const groups = groupsQ.data ?? [];
  const isMember = !!user && groups.some((g) => g.id === list.groupId);
  const canCheck = isMember;

  const done = list.items.filter((i) => i.done).length;
  const pct = list.items.length === 0 ? 0 : (done / list.items.length) * 100;

  const handleToggle = (itemId: string, currentlyDone: boolean) => {
    if (!canCheck) return;
    void updateItem.mutateAsync({
      itemId,
      listId: list.id,
      groupId: list.groupId,
      done: !currentlyDone,
    });
  };

  return (
    <PublicShell>
      <OgMeta
        type={kind}
        slug={slug}
        title={list.title}
        description={`${done} / ${list.items.length} tâches terminées`}
      />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 40px' }}>
        <PublicHero
          icon="listChecks"
          iconColor={NX.success}
          iconBg={NX.successBg}
          type={kind === 'list' ? 'Liste partagée' : 'Liste de tâches'}
          groupName="Groupe nexus"
          title={list.title}
          gradientFrom={`${NX.success}1F`}
          gradientTo={`${NX.success}0A`}
          meta={`${done}/${list.items.length} cochés`}
        />

        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: NX.border,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: pct === 100 ? NX.success : NX.warning,
              borderRadius: 2,
              transition: 'width 0.3s',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {list.items.length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: NX.fgDim,
                fontStyle: 'italic',
                padding: '16px 0',
                textAlign: 'center',
              }}
            >
              Liste vide.
            </div>
          ) : null}
          {list.items.map((todo) => {
            const isDisabled = !canCheck || updateItem.isPending === true || !membershipResolved;
            const display = todo.assigneeId ? todo.assigneeId.slice(0, 8) : null;
            return (
              <button
                key={todo.id}
                type="button"
                onClick={() => handleToggle(todo.id, todo.done)}
                disabled={isDisabled}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: NX.elevated,
                  borderRadius: NX.radiusSm,
                  border: `1px solid ${todo.done ? NX.success : NX.border}`,
                  cursor: canCheck ? 'pointer' : 'default',
                  textAlign: 'left',
                  opacity: !membershipResolved ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    border: `2px solid ${todo.done ? NX.success : NX.borderHover}`,
                    background: todo.done ? NX.success : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {todo.done ? <PhIcon name="check" size={12} color="#0b1a14" /> : null}
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
                {display ? <Avatar name={display} size={22} /> : null}
              </button>
            );
          })}
        </div>

        {!membershipResolved ? null : !canCheck ? (
          <PublicCTAFooter
            message={
              !user
                ? 'Connecte-toi à nexus pour cocher les items.'
                : 'Tu n’es pas membre de ce groupe.'
            }
          />
        ) : null}
      </div>
    </PublicShell>
  );
}
