# ADR-034 : Préférences de notification par utilisateur

**Date** : 2026-06-02
**Statut** : Accepté

## Contexte

La V1.2 a livré les notifications transverses (ADR-023) : table `notifications`,
cloche + panneau in-app, WS `notification:created`, et des producteurs (worker
`event-reminders`, RSVP demandés/reçus, dépenses ajoutées, todos
assignées/cochées). L'écran Réglages affiche une section « Notifications » avec
des toggles — mais ils n'étaient **branchés sur rien** : aucune persistance,
aucun effet sur la production des notifs. Un utilisateur ne pouvait donc pas
couper un type de notif bruyant.

Il fallait : (1) persister une préférence par `kind` de notification, (2) la
respecter à la source pour qu'un `kind` désactivé ne génère **ni** ligne en DB
**ni** push WS, et (3) câbler les toggles existants.

Les `kind` proviennent de `NotificationKindSchema` (`@nexus/shared`) : six
valeurs — `event_reminder`, `event_rsvp_requested`, `event_rsvp_received`,
`expense_added`, `todo_assigned`, `todo_completed`.

## Options envisagées

1. **Blob JSONB `preferences` sur `users`** — une colonne `jsonb` libre. Rejeté :
   pas de `NOT NULL DEFAULT` par flag, filtrage SQL malcommode côté enforcement,
   et migration de forme implicite à chaque évolution du blob.
2. **Table dédiée `user_notif_prefs`, une colonne booléenne par `kind`**
   (PK `user_id`, défaut `true`). Retenu : contrainte `NOT NULL DEFAULT true`
   native, lecture/écriture triviales, mapping `kind → colonne` typé.
3. **Enforcement dans chaque producteur** (chaque route/worker teste la pref
   avant d'émettre). Rejeté : non-DRY, six sites à garder synchronisés, risque
   d'oubli au prochain producteur.
4. **Enforcement au choke point d'insertion** (`repo.insertNotification` /
   `insertNotificationsBulk`, appelés par TOUS les producteurs). Retenu : un seul
   endroit, tout nouveau producteur en hérite gratuitement.

## Décision

Options 2 + 4.

- **Modèle** : table `user_notif_prefs` (migration `0014`), un booléen par
  `kind`, `NOT NULL DEFAULT true` (sémantique **opt-out** : par défaut on reçoit
  tout). PK `user_id` (cascade delete avec le user), `updated_at`. La ligne est
  créée **paresseusement** au premier `GET /preferences` (et au premier `PATCH`)
  via `ON CONFLICT DO NOTHING`.
- **API** : `GET /api/v1/notifications/preferences` et
  `PATCH /api/v1/notifications/preferences` (partiel, strict — clé inconnue →
  `VALIDATION_ERROR` 400), tous deux sous `requireAuth`, étendus dans le
  `notificationsPlugin` existant (pas de nouveau plugin, `server.ts` intact).
- **Enforcement** : `insertNotification` renvoie désormais `Notification | null`
  (`null` = `kind` désactivé pour ce user → pas d'insert, et le caller garde son
  publish WS derrière le `null`). `insertNotificationsBulk` filtre les
  destinataires désactivés **avant** l'insert ; les callers itérant sur les
  lignes renvoyées skippent automatiquement les destinataires filtrés. Le test
  `(userId, kind)` est centralisé dans `prefs-repo.ts`
  (`shouldNotify` / `filterRecipientsByPref`).
- **Best-effort** : une erreur de lecture des prefs renvoie `true` (autorisé) —
  on ne doit jamais avaler silencieusement une notif à cause d'un hoquet DB.

## Conséquences

- **Positif** : un seul point d'enforcement couvre les six producteurs actuels
  et tout futur producteur ; les toggles Réglages deviennent fonctionnels.
- **Positif** : opt-out par défaut → aucune régression pour les users existants
  (tout reste activé tant qu'ils ne touchent à rien ; la ligne n'existe même pas
  avant le premier accès).
- **Négatif** : un nouveau `kind` impliquera une migration (ajout de colonne) en
  plus de l'entrée d'enum. Acceptable au rythme d'évolution des kinds, et le
  schéma reste lisible/typé (vs un blob JSONB opaque).
- **Neutre** : la rétention 30 j des notifications (ADR-023) est inchangée ; les
  préférences elles-mêmes ne sont jamais purgées (supprimées en cascade avec le
  user). Le DTO/Zod des prefs reste backend-local (`routes/notifications/schemas.ts`),
  non exposé via `@nexus/shared` — le front redéfinit le type côté `queries.ts`.
