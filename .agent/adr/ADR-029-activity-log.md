# ADR-029 : Activity log append-only (Bloc E HomeDashboard)

**Date** : 2026-05-05
**Statut** : Accepté

## Contexte

Le HomeDashboard (cf. ADR-024) couvre déjà 4 sections actionnelles : RSVP en attente, dépenses non réglées, todos assignées, prochains events. Manu a validé l'ajout de 4 blocs supplémentaires (A/B/C/D — Quick Actions, WeekCalendar, Pending Polls, ExpenseBalance) le 2026-05-05. Reste un cinquième bloc explicitement demandé : **"Activité récente cross-feature — qui a fait quoi récemment"**.

Limites de l'existant pour couvrir ce besoin :

1. **Pas de notion d'historique cross-feature**. Les `notifications` (cf. ADR-023) sont user-scoped et ne capturent que les événements pour lesquels un user spécifique doit être averti (rappels d'events, expenses ajoutées au groupe, todos assignées). Elles ne couvrent pas "Manu a créé l'event 'Brunch'" du point de vue d'un autre membre.
2. **Pas de table de log**. Les events/polls/expenses/todos individuels ont des `created_at` mais pas d'historique des actions secondaires (RSVP changé, vote, settle, item checked).
3. **Sentiment de vie collective absent**. Les utilisateurs en bande veulent revenir sur l'app et voir "ce qui s'est passé pendant que je n'étais pas là", pas seulement leurs items personnels.

Spécification actée par Manu (réponses 2026-05-05) :

- **Scope** : trans-groupes (Home Nexus) ET par-groupe (GroupHomeDashboard) — même endpoint avec query param `?groupId=...`
- **Kinds V1** : `event:created`, `event:rsvp:changed`, `event:cancelled`, `poll:created`, `poll:voted`, `poll:closed`, `expense:added`, `expense:settled`, `todo_list:created`, `todo_item:checked`, `todo_item:assigned`, `member:joined`, `member:left`
- **Pas en V1** : updates de champs (trop bruyant), actions message (Discord/WhatsApp en webview, pas accessibles)
- **Émission** : inline dans chaque route mutation (pas via worker)
- **Dénormalisation** : snapshot dans `payload jsonb` (actorName, targetTitle, groupName) → pas de JOIN à la lecture
- **Conservation** : pas de purge auto en V1, on garde tout
- **UI** : timeline avec avatar + texte humain + timestamp relatif + chip groupe (Home only) + click → deep-link

## Options envisagées

### Modèle de données

A. **Table dédiée `activity_log`** append-only avec colonnes typées (`id`, `group_id`, `actor_id`, `kind`, `target_id`, `target_type`, `payload jsonb`, `created_at`).

- **Pro** : modèle clair, query naturelle (filtre par groupe, tri par date), index optimaux, cascade simple sur groupe.
- **Con** : nouveau modèle à maintenir, risque de drift avec la table d'origine de l'item (mais résolu par snapshot dans payload).

B. **Réutiliser la table `notifications`** en relâchant la contrainte user-spécifique (ajouter une notion de "broadcast au groupe" sans `user_id` requis).

- **Pro** : pas de nouvelle table.
- **Con** : couplage moche (notifications est un produit fonctionnellement différent — actionnabilité user-spécifique vs. log collectif), changements destructifs sur une table critique, requiert de faire évoluer les routes notifications déjà stables.

C. **Stream Redis + projections périodiques** (ex : Redis Stream `activity:groupId` que le front read directement).

- **Pro** : très scalable.
- **Con** : sur-ingénieré pour le volume cible (~1000 entries/jour total à terme — un PostgreSQL scrolle ça sans broncher), perd la durabilité offerte par PG.

### Émission

E1. **Inline dans la transaction de la route mutation**. Chaque route (POST /events, POST /events/:id/rsvp, etc.) appelle `recordActivity(...)` après l'insert principal, dans la même transaction.

- **Pro** : atomique (soit les deux passent, soit rien), zéro désync, code direct.
- **Con** : les routes sont touchées (~15 lignes par route).

E2. **Worker BullMQ qui consomme les events Redis WS**. On publie déjà des events `event:created`, `poll:voted`, etc. sur Redis. Un worker side-car les transforme en activité.

- **Pro** : routes inchangées, évolution asynchrone.
- **Con** : risque de désync (Redis pub/sub n'est pas persistant — un crash worker = entrée perdue), latence variable, debug difficile, ajoute une dépendance critique.

### Suppression / cascade

C1. **`ON DELETE CASCADE` sur `group_id`** : si le groupe est supprimé, son historique aussi.
C2. **`ON DELETE SET NULL` sur `actor_id`** : si le user est supprimé, on garde l'entrée avec un actor anonyme ("Un membre a créé...").

### Émission de la cible supprimée

T1. **Garder l'entrée** même si le target (event/poll/expense/todo) est supprimé. Le snapshot dans `payload` reste utile ("Manu a créé l'event 'Brunch'" même si l'event est annulé après).
T2. **Cascade DELETE sur target_id** : on retire l'entrée d'activité quand l'item original est supprimé. → perd l'historique, contre-productif.

## Décision

- **Modèle : option A** (table dédiée `activity_log`). Le couplage avec `notifications` (option B) serait néfaste car ce sont deux produits fonctionnels distincts. Le stream Redis (option C) est sur-ingénieré.
- **Émission : option E1** (inline dans la route). Atomicité > flexibilité pour ce volume.
- **Cascade : C1 + C2 + T1**. Groupe supprimé → cascade. User supprimé → SET NULL (historique préservé). Target supprimé → entrée conservée (snapshot dans payload).
- **Pas de RLS PostgreSQL** : le filtrage par membership reste côté SQL via INNER JOIN sur `group_members` (cohérent avec le reste du codebase, cf. routes home/repo.ts).

## Schéma SQL

```sql
CREATE TABLE activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  kind         text NOT NULL,
  target_id    uuid,           -- pas de FK : la cible peut être supprimée
  target_type  text NOT NULL,  -- 'event' | 'poll' | 'expense' | 'todo_list' | 'todo_item' | 'member'
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Index principal pour la requête timeline (filtre par groupe + tri desc).
CREATE INDEX activity_log_group_created_idx
  ON activity_log (group_id, created_at DESC);

-- BRIN pour le tri global (Home cross-groupes). BRIN est ~100x plus petit
-- qu'un B-tree sur created_at et suffit pour des scrolls chronologiques.
CREATE INDEX activity_log_created_brin
  ON activity_log USING BRIN (created_at);
```

### Format `payload`

Snapshot dénormalisé pour permettre l'affichage sans JOIN :

```json
{
  "actorName": "Manu", // displayName de l'actor au moment de l'action
  "targetTitle": "Brunch", // titre/question/description de la cible
  "groupName": "Les potes", // utile pour la timeline cross-groupes
  // Champs spécifiques au kind :
  "rsvp": "yes", // pour event:rsvp:changed
  "amountCents": 2500, // pour expense:added/settled
  "currency": "EUR",
  "optionLabel": "Pizza", // pour poll:voted
  "itemText": "Acheter pain" // pour todo_item:checked/assigned
}
```

### Mapping kind → texte humain (front)

| Kind                 | Template (fr)                                         |
| -------------------- | ----------------------------------------------------- |
| `event:created`      | "{actor} a créé l'event « {target} »"                 |
| `event:rsvp:changed` | "{actor} a répondu {rsvp} à « {target} »"             |
| `event:cancelled`    | "{actor} a annulé l'event « {target} »"               |
| `poll:created`       | "{actor} a lancé le sondage « {target} »"             |
| `poll:voted`         | "{actor} a voté « {optionLabel} » dans « {target} »"  |
| `poll:closed`        | "Le sondage « {target} » est clos"                    |
| `expense:added`      | "{actor} a ajouté la dépense « {target} » ({amount})" |
| `expense:settled`    | "{actor} a réglé sa part de « {target} »"             |
| `todo_list:created`  | "{actor} a créé la liste « {target} »"                |
| `todo_item:checked`  | "{actor} a coché « {itemText} »"                      |
| `todo_item:assigned` | "{actor} a assigné « {itemText} » à {assigneeName}"   |
| `member:joined`      | "{actor} a rejoint le groupe"                         |
| `member:left`        | "{actor} a quitté le groupe"                          |

## Conséquences

**Positives**

- Sentiment de vie collective restauré dans Home et GroupHome.
- Modèle simple, queries SQL directes (pas de raisonnement applicatif côté lecture).
- Émission inline = atomicité absolue (pas de risque "l'event existe mais pas son entrée d'activité").
- Snapshot payload = lecture indépendante de l'état actuel des items (l'historique ne casse pas si on renomme/supprime).

**Négatives**

- Toutes les routes mutation existantes doivent être touchées pour appeler `recordActivity()`. Mitigation : helper centralisé qui catch les erreurs (un échec d'insert log ne doit pas casser la mutation principale — log warn + continue).
- Volume linéaire dans le temps. À ~10 actions/jour/groupe × 100 groupes actifs → ~1k/jour → 365k/an. PostgreSQL avec BRIN tient sans souci. Si on dépasse 10M lignes (>10 ans à ce rythme, ou explosion d'usage), on partitionnera par range sur `created_at`.
- Snapshot payload duplique de l'info → drift possible si le titre de l'event est changé après. **Intentionnel** : c'est un log historique, pas une vue actuelle.

**Neutres**

- L'endpoint `/activity-feed` est paginé cursor-based (pas offset SQL → pas de drift en cas d'insertion concurrente).
- Pas d'event WS dédié à l'activité en V1. Le front rafraîchit via TanStack Query (refetchOnWindowFocus + interval 60s, identique à HomeFeed).
- Si on voit un besoin de notifications "live" sur l'activité (ex : un user voudrait être prévenu en temps réel quand quelqu'un crée un event dans son groupe), ce sera couvert par le système de notifications transverses existant — pas par activity_log directement.
