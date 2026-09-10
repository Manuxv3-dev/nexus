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
 *    de rôle (cf. MAN-180), un transfert d'ownership (cf. MAN-181) ou un
 *    retrait — kick ou self-leave (cf. MAN-182).
 *  - la liste des groupes (`['groups']`) sur un retrait : depuis 28514439, la
 *    personne éjectée reçoit cet event, et son groupe doit disparaître.
 *  - le feed Home (`['home']`) sur tout ce qui l'alimente (cf. 0df77e79).
 *    Le pendant distant de la règle d'invalidation du `MutationCache` (cf.
 *    `lib/queryClient.ts`), qui ne couvre que MES mutations : sans ça, un
 *    event créé par quelqu'un d'autre n'apparaît sur ma Home qu'au prochain
 *    tick de 60 s. Volontairement absent du `default` : les events de
 *    messagerie et de présence y passent en rafale, et n'alimentent aucune
 *    section de la Home. `event:reminder` non plus n'a pas à y figurer — le
 *    worker publie AUSSI un `notification:created` (cf.
 *    `backend/src/workers/event-reminders.ts`), qui rafraîchit `unreadByGroup`
 *    pour lui ; l'ajouter ferait un aller-retour en double.
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
          void qc.invalidateQueries({ queryKey: ['home'] });
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
          void qc.invalidateQueries({ queryKey: ['home'] });
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
          void qc.invalidateQueries({ queryKey: ['home'] });
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
          void qc.invalidateQueries({ queryKey: ['home'] });
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

        // ─── Transfert d'ownership (MAN-181) ────────────────
        // L'ancien et le nouveau owner changent tous les deux de rôle en une
        // seule opération atomique : une invalidation de la liste complète
        // suffit, pas besoin de mettre à jour deux entrées individuellement.
        case 'group:ownership_transferred':
          void qc.invalidateQueries({ queryKey: ['group-members', event.groupId] });
          break;

        // ─── Retrait d'un membre (MAN-182) ──────────────────
        // Kick ou self-leave : les autres clients du groupe doivent voir
        // disparaître la ligne du membre retiré sans reload. La personne
        // retirée elle-même a sa propre notification `member_removed`
        // (kick uniquement) — cet event, lui, est diffusé dans les deux cas.
        case 'member:removed':
          void qc.invalidateQueries({ queryKey: ['group-members', event.groupId] });
          // Depuis 2f422033, un départ change aussi ce que voient les membres
          // RESTANTS : les RSVP et les votes du partant sortent des décomptes,
          // et les todos qui lui étaient assignés redeviennent libres. Ces
          // trois vues sont scopées par groupe, pas par user — contrairement
          // à la Home.
          void qc.invalidateQueries({ queryKey: ['events', event.groupId] });
          void qc.invalidateQueries({ queryKey: ['polls', event.groupId] });
          void qc.invalidateQueries({ queryKey: ['todos', event.groupId] });
          // Et si le membre retiré, c'est MOI, le groupe doit disparaître de
          // ma liste sans attendre. Depuis 28514439 je reçois bien cet event
          // (le relay m'ajoute explicitement aux destinataires alors que je ne
          // suis plus membre) — encore faut-il en faire quelque chose.
          void qc.invalidateQueries({ queryKey: ['groups'] });
          // Toujours pas d'invalidation de la Home ici, et ce n'est pas une
          // incohérence : ses 7 sections sont scopées sur MON userId et MA
          // membership, que le départ d'un tiers ne change pas. Quant à la
          // personne retirée, elle ne reçoit pas cet event (le relay résout
          // `groupId` vers les membres COURANTS, et `removeMember` appelle
          // `invalidateGroup` juste avant de publier) ; son self-leave est
          // couvert par la règle du `MutationCache` via `useLeaveGroup`.
          break;

        // ─── Notifications transverses (cf. ADR-023) ────────────────
        case 'notification:created':
          void qc.invalidateQueries({ queryKey: ['notifications'] });
          void qc.invalidateQueries({ queryKey: ['home'] });
          break;

        // Les events de plomberie messages / presence sont gérés par le
        // hook propre à AppShell — pas notre rôle ici.
        default:
          break;
      }
    },
  });
}
