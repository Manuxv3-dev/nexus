/**
 * Hook global de synchro WS pour les killer features.
 *
 * Se connecte au WebSocket dès que l'utilisateur est authentifié (peu importe
 * la route — fonctionne aussi sur les pages publiques `/e/:slug`, `/p/:slug`
 * etc. quand consultées par un membre du groupe). À chaque event killer
 * feature reçu, invalide :
 *  - la query dashboard (`['events', groupId]`, `['polls', groupId]`, …)
 *  - la query détail (`['event', eventId]`, …)
 *  - les queries publiques (`['public-event', *]`, `['public-poll', *]`, …)
 *    via prédicat (on n'a pas le slug dans le payload, on invalide tout).
 *  - la liste des membres (`['group-members', groupId]`) sur un changement
 *    de rôle (cf. MAN-180).
 *
 * Le hook est monté au niveau du Router (cf. `router.tsx` → `RootComponent`)
 * pour rester actif sur toutes les routes auth.
 */
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from './auth';
import { useWs } from './ws';

export function useKillerFeaturesWs() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const initializing = useAuth((s) => s.initializing);

  useWs({
    enabled: !initializing && !!user,
    onEvent: (event) => {
      switch (event.type) {
        // ─── Events ──────────────────────────────────────────────────
        case 'event:created':
        case 'event:updated':
        case 'event:deleted':
        case 'event:rsvp':
          void qc.invalidateQueries({ queryKey: ['events', event.groupId] });
          if ('eventId' in event.payload) {
            void qc.invalidateQueries({ queryKey: ['event', event.payload.eventId] });
          }
          // Public pages : on ne connaît pas le slug, on invalide tout
          // `public-event` (cheap : 1 page publique ouverte typiquement).
          void qc.invalidateQueries({ queryKey: ['public-event'] });
          break;

        // ─── Polls ───────────────────────────────────────────────────
        case 'poll:created':
        case 'poll:updated':
        case 'poll:deleted':
        case 'poll:voted':
          void qc.invalidateQueries({ queryKey: ['polls', event.groupId] });
          if ('pollId' in event.payload) {
            void qc.invalidateQueries({ queryKey: ['poll', event.payload.pollId] });
          }
          void qc.invalidateQueries({ queryKey: ['public-poll'] });
          break;

        // ─── Expenses ────────────────────────────────────────────────
        case 'expense:added':
        case 'expense:updated':
        case 'expense:deleted':
        case 'expense:settled':
          void qc.invalidateQueries({ queryKey: ['expenses', event.groupId] });
          if ('expenseId' in event.payload) {
            void qc.invalidateQueries({ queryKey: ['expense', event.payload.expenseId] });
          }
          void qc.invalidateQueries({ queryKey: ['public-expense'] });
          break;

        // ─── Todos ───────────────────────────────────────────────────
        case 'todo_list:created':
        case 'todo_list:updated':
        case 'todo_list:deleted':
        case 'todo_item:added':
        case 'todo_item:updated':
        case 'todo_item:checked':
        case 'todo_item:deleted':
          void qc.invalidateQueries({ queryKey: ['todos', event.groupId] });
          if ('listId' in event.payload) {
            void qc.invalidateQueries({ queryKey: ['todo-list', event.payload.listId] });
          }
          void qc.invalidateQueries({ queryKey: ['public-todo'] });
          break;

        // ─── Membres du groupe (MAN-180) ──────────────────
        // Le rôle d'un membre a changé : la liste des membres — et donc la
        // visibilité des actions de gestion, recalculée à partir des rôles
        // — est périmée pour tous les clients du groupe, y compris celui
        // qui vient de perdre ou gagner ses droits.
        case 'member:role_updated':
          void qc.invalidateQueries({ queryKey: ['group-members', event.groupId] });
          break;

        // ─── Notifications transverses (cf. ADR-023) ────────────────
        case 'notification:created':
          void qc.invalidateQueries({ queryKey: ['notifications'] });
          break;

        // Les events de plomberie messages / presence sont gérés par le
        // hook propre à AppShell — pas notre rôle ici.
        default:
          break;
      }
    },
  });
}
