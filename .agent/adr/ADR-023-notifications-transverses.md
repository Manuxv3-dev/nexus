# ADR-023 : Système de notifications transverses (V1.2)

**Date** : 2026-05-03
**Statut** : Accepté

## Contexte

Avec la livraison du worker de rappels d'events (#42, ADR-020), Nexus émet
des `event:reminder` via WebSocket. Limitation immédiate identifiée par
Manu : si un user n'est pas connecté au moment du rappel, **il rate la
notif sans recours**. Le toast est éphémère (8 secondes), pas d'historique
consultable.

Cette limitation est en réalité un cas particulier d'un besoin transverse :
pour TOUTES les actions importantes (expense ajoutée à régler, todo
assignée, RSVP demandé sur un event créé, rappel d'event qui approche),
l'utilisateur a besoin :

1. D'un feedback **immédiat** s'il est connecté (toast WS — déjà en place)
2. D'un **historique consultable** s'il est offline ou s'il rate le toast

L'historique demande un système de notifications **persisté en DB**, avec
panneau in-app pour les lire / marquer comme lu, et infrastructure scalable
pour ajouter de nouvelles sources sans réinventer la plomberie à chaque
fois.

## Spec actée (cf. session 2026-05-03)

### Scope V1 — 4 sources de notifs

| Kind                   | Trigger                                                  | Audience                                           |
| ---------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `event_reminder`       | Worker BullMQ `event-reminders` à T-24h / T-1h           | Members du group sauf RSVP=`no`                    |
| `event_rsvp_requested` | POST `/api/v1/groups/:groupId/events` (création)         | Tous les members **sauf** le créateur              |
| `expense_added`        | POST `/api/v1/groups/:groupId/expenses`                  | Co-payeurs (shares non nulles) **sauf** le payeur  |
| `todo_assigned`        | PATCH `/api/v1/todo-items/:id` quand `assigneeId` change | Le nouvel assigné (sauf si assignation à soi-même) |

**Pas en V1** : messages bridges Discord/WA (trop bruyant — demande règles
fines comme mute par channel, mention only, etc.). Pas de notifs push
natives mobiles (V2 avec Expo). Pas d'email digest (V2).

### Rétention

30 jours, puis purge automatique via worker BullMQ nocturne (cf. lot C4).

### Comportement marquage lu

- Manuel au clic sur une notif (passe en `read_at = now()`)
- Bouton « Tout marquer lu » global (passe toutes les notifs unread du
  user en read en une requête)
- **Pas** d'auto-read au montage du panneau (frustrant si on ouvre juste
  pour vérifier)
- Pattern Slack/Discord : badge de count unread sur l'icône cloche, le
  panneau liste les unread + read mélangés avec marker visuel

### Schema DB

Nouvelle table `notifications` :

```sql
CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,           -- enum côté code, pas SQL pour souplesse
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_id      UUID REFERENCES groups(id) ON DELETE CASCADE,
  source_id     UUID,                    -- id de la ressource source (event, expense, todo_item)
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_at       TIMESTAMP WITH TIME ZONE
);

CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, read_at NULLS FIRST, created_at DESC);
CREATE INDEX notifications_user_created_idx
  ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_purge_idx
  ON notifications (created_at);  -- pour le worker de purge
```

Convention :

- `kind` : string union côté TS (`event_reminder` | `event_rsvp_requested`
  | `expense_added` | `todo_assigned`). Pas d'enum SQL pour permettre
  d'ajouter un kind sans migration.
- `payload` : JSONB libre, shape par `kind` documentée dans Zod (cf. lot C1).
- `source_id` : pointe vers la ressource (event.id, expense.id, todo_item.id).
  Pas de foreign key parce que la ressource peut être supprimée — on garde
  la notif comme trace historique.
- `group_id` : utile pour deep-linking (cliquer sur la notif → ouvre le
  bon groupe + dashboard concerné).

### Endpoints REST

```
GET  /api/v1/notifications?unread=true&limit=50&cursor=<created_at_iso>
POST /api/v1/notifications/:id/read
POST /api/v1/notifications/read-all
```

Cursor pagination par `created_at` desc (tie-break sur id pour stabilité).

### WS event

Nouveau type `notification:created` ajouté à `@nexus/shared/ws-protocol.ts` :

```ts
{
  type: 'notification:created',
  groupId: string | null,   // optionnel — peut être null pour notifs cross-group V2
  timestamp: number,
  payload: {
    notificationId: string,
    userId: string,          // le destinataire — le client filtre comme pour event:reminder
    kind: NotificationKind,
  }
}
```

Le client filtre sur son userId (cf. pattern event:reminder) et déclenche :

- Refetch de `['notifications']` query
- Optionnel : flash discret sur l'icône cloche

### Producteurs

Le worker BullMQ `event-reminders` (cf. ADR-020) **double-écrit** :

1. `publishNexusEvent({ type: 'event:reminder', ... })` — toast immédiat (existant)
2. `insertNotification({ kind: 'event_reminder', ... })` x N users — historique (nouveau)

Les routes mutations (`POST events`, `POST expenses`, `PATCH todo-items`)
font de même : après commit DB, fan-out vers les destinataires concernés.
Documenté dans le lot C2.

### UI

Lot C3. Composant `NotificationsPanel` rendu en glass dropdown depuis
l'icône cloche AppShell. Liste les notifs avec icône feature + résumé +
ago + bouton "marquer lu". Header avec count unread + bouton "Tout marquer
lu". Pagination infinite-scroll.

## Options envisagées

### Option A — Polling REST sans WS

Le client polle `GET /notifications?unread=true` toutes les 30 sec.

**Pour** : simple, pas de WS event additionnel.
**Contre** : latence 0-30 sec, charge serveur inutile, pas de "effet temps
réel" qui justifie justement Nexus.

### Option B — Topic WS dédié `notifications:<userId>`

Un canal WS par user.

**Pour** : pas de filtre client.
**Contre** : casse l'architecture WS actuelle (broadcast par groupe). Demande
de revoir `nexus-relay`. Sur-engineering pour V1.

### Option C (retenue) — `notification:created` broadcast par group + filtre client

L'event WS contient `payload.userId`, le client filtre sur son userId (même
pattern que `event:reminder`).

**Pour** : aligne avec le pattern existant, zéro changement infra WS,
trivial à implémenter.
**Contre** : tous les members du group reçoivent l'event, légère fuite
(ils savent qu'untel a une notif sans en connaître le contenu). Acceptable
en V1, dette V2 si on veut du strict per-user.

## Décision

**Option C.**

Validé par Manu (2026-05-03) avec ces choix structurants pour le scope V1 :

- 4 sources : rappels events + RSVP demandés + expenses + todos assignées
- Rétention 30j puis purge auto BullMQ
- Marquage lu manuel + bouton "tout marquer lu"
- Pas de messages bridges en V1 (trop bruyant)

## Conséquences

### Positives

- **Historique consultable** quel que soit le moment (online ou offline)
- **Pattern réutilisable** : ajouter une nouvelle source = 1 nouveau `kind`
  - 1 producteur, pas de plomberie à recréer
- **Source de vérité unique** : si demain on veut un email digest hebdo,
  on lit la table notifications
- **Retention raisonnable** (30j) qui n'enfle pas la DB
- **Cohérent avec le pattern event:reminder** existant (même filtre WS,
  même structure payload)

### Négatives

- **Légère fuite** côté WS broadcast (cf. option C). Acceptable.
- **Nouveau service systemd** sur le VPS pour le worker de purge (lot C4) —
  à intégrer dans ADR-012.
- **Bruit potentiel** si un user est dans beaucoup de groupes actifs.
  Pas de filtre/mute en V1 — à reconsidérer si ça remonte.

### Neutres

- ADR-020 (worker reminders) reste valide ; sera juste enrichi en C2 pour
  insert en DB en plus du WS publish.
- WS protocol étend la discriminated union — bump mineur du contrat shared.

## Implications opérationnelles VPS

- **Pas de nouveau service** pour le backend HTTP (les endpoints sont
  servis par Fastify existant).
- **Nouveau service** `nexus-worker-purge-notifications` pour le lot C4 :
  très léger (1 job/nuit, DELETE en batch sur table indexée). Compter
  ~50 Mo RAM, négligeable.
- Migration DB à passer en prod via la procédure ADR-013 (expand/contract).
  La nouvelle table est purement additive, pas de risque de cassure.
