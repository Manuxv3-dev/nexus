# Format d'export d'un groupe (JSON)

`GET /api/v1/groups/:groupId/export` — ticket Cortex `645f29ca`.

Complète le volet RGPD ouvert par la suppression de compte (ADR-033) : avant
de partir, un utilisateur doit pouvoir récupérer les données d'un groupe.
Sert aussi de sauvegarde personnelle.

## Autorisation

**Owner ou admin du groupe uniquement** (`GroupRole`, cf.
`packages/backend/src/routes/groups/schemas.ts`). Un membre simple reçoit
403 `PERMISSION_DENIED` : l'export contient les données de **tous** les
membres (parts de dépenses, votes, RSVP), pas seulement celles de
l'appelant — au-delà de ce qu'un membre voit habituellement d'un coup.

| Cas                                                       | Code                     |
| --------------------------------------------------------- | ------------------------ |
| Owner ou admin du groupe                                  | 200                      |
| Membre simple                                             | 403 `PERMISSION_DENIED`  |
| Non-membre (ou groupe inexistant, indistinct — anti-leak) | 404 `RESOURCE_NOT_FOUND` |
| Une collection dépasse le plafond (5000 lignes)           | 413 `EXPORT_TOO_LARGE`   |

Le plafond est vérifié par un `count(*)` par collection, **avant** tout
chargement (5 requêtes en parallèle, cf. `countExportCollections` dans
`routes/groups/export.ts`) — un groupe hors gabarit part en 413 sans
qu'aucune ligne n'ait été chargée en mémoire.

## Disponibilité côté client — web-only pour l'instant

L'endpoint lui-même n'a aucune contrainte de plateforme. Le bouton "Exporter
le groupe (JSON)" (Réglages → Groupes) est en revanche **masqué en mode
natif** (`isTauri()`, `packages/web/src/screens/settings/GroupsSection.tsx`).

Raison (revue #122) : le téléchargement s'appuie sur `Blob` + `<a download>`
depuis une URL `blob:`, fiable uniquement sur WebView2 (Windows, moteur
Chromium). La release desktop cible aussi macOS (WKWebView) et Linux
(WebKitGTK), qui ignorent ou annulent `download` sans un handler
`on_download` explicite côté Tauri — le clic échouerait silencieusement sur
ces plateformes tout en affichant un toast « téléchargé », un contrôle qui
ment sur ce qu'il vient de faire (cf. principe MAN-243). Le dialogue de
sauvegarde natif (`plugin-dialog` `save()` + `plugin-fs` `writeTextFile`) est
ticketé séparément.

## Réponse

Synchrone — un groupe de bande d'amis tient en quelques centaines de Ko, pas
de job asynchrone. `Content-Type: application/json`,
`Content-Disposition: attachment; filename="nexus-<slug-du-groupe>-<AAAAMMJJ>.json"`
(déclenche un téléchargement plutôt qu'un rendu dans l'onglet).

Le corps est validé par `GroupExportSchema`
(`packages/backend/src/routes/groups/export-schema.ts`) — **contrat
stable**, documenté ci-dessous champ par champ. Un changement non
rétrocompatible (champ retiré ou retypé) doit incrémenter `formatVersion`.

> **Note d'implémentation** : `GroupExportSchema` vit aujourd'hui dans le
> backend plutôt que dans `@nexus/shared`, le temps qu'un chantier parallèle
> (ticket `0e8b5905`) y migre les DTO events/polls/expenses/todos/groupes
> dont il compose le schéma.

### Racine

| Champ           | Type                | Sens                                                        |
| --------------- | ------------------- | ----------------------------------------------------------- |
| `formatVersion` | `1` (littéral)      | Version du format. Change uniquement sur rupture de compat. |
| `exportedAt`    | `string` (ISO 8601) | Horodatage de génération de l'export.                       |
| `exportedBy`    | `string` (UUID)     | Id du user ayant déclenché l'export.                        |
| `group`         | `GroupDto`          | Le groupe (cf. tableau dédié).                              |
| `members`       | `GroupMemberDto[]`  | Tous les membres actuels du groupe.                         |
| `events`        | `EventDto[]`        | Tous les événements du groupe, RSVP inclus.                 |
| `polls`         | `PollDto[]`         | Tous les sondages du groupe, options + votants inclus.      |
| `expenses`      | `ExpenseDto[]`      | Toutes les dépenses du groupe, parts incluses.              |
| `todoLists`     | `TodoListDto[]`     | Toutes les listes de todo du groupe, items inclus.          |

Chaque collection reflète l'état **courant** de la base — pas d'historique
des suppressions, pas de pagination : un groupe hors gabarit (> 5000 lignes
sur une collection) fait échouer l'export entier en 413 plutôt que de
renvoyer un sous-ensemble silencieusement tronqué.

### `group` (`GroupDto`)

| Champ                     | Type                | Sens            |
| ------------------------- | ------------------- | --------------- |
| `id`                      | `string` (UUID)     | Id du groupe.   |
| `name`                    | `string`            | Nom du groupe.  |
| `createdBy`               | `string` (UUID)     | Id du créateur. |
| `createdAt` / `updatedAt` | `string` (ISO 8601) | Horodatages.    |

### `members[]` (`GroupMemberDto`)

Exactement ce que `GET /groups/:groupId/members` expose déjà à tout membre
— aucune PII supplémentaire n'est ajoutée pour l'export.

| Champ         | Type                             | Sens                          |
| ------------- | -------------------------------- | ----------------------------- |
| `userId`      | `string` (UUID)                  | Id du membre.                 |
| `email`       | `string`                         | Email du membre.              |
| `displayName` | `string`                         | Nom d'affichage.              |
| `avatarUrl`   | `string \| null`                 | Avatar.                       |
| `role`        | `'owner' \| 'admin' \| 'member'` | Rôle dans le groupe.          |
| `joinedAt`    | `string` (ISO 8601)              | Date d'entrée dans le groupe. |

### `events[]` (`EventDto`)

| Champ                     | Type                        | Sens                                                                                                                                                                                                                                          |
| ------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` / `slug`             | `string`                    | Identifiants (le slug sert aux pages publiques `/e/:slug`).                                                                                                                                                                                   |
| `groupId`                 | `string` (UUID)             | Groupe parent.                                                                                                                                                                                                                                |
| `tags`                    | `string[]`                  | Tags libres.                                                                                                                                                                                                                                  |
| `title` / `description`   | `string` / `string \| null` | Contenu.                                                                                                                                                                                                                                      |
| `startsAt`                | `string` (ISO 8601)         | Date/heure de l'événement.                                                                                                                                                                                                                    |
| `location`                | `string \| null`            | Lieu.                                                                                                                                                                                                                                         |
| `createdBy`               | `string` (UUID)             | Créateur.                                                                                                                                                                                                                                     |
| `createdAt` / `updatedAt` | `string` (ISO 8601)         | Horodatages.                                                                                                                                                                                                                                  |
| `rsvps`                   | `{ userId, value }[]`       | Une entrée par membre ayant répondu. `value` ∈ `'yes' \| 'maybe' \| 'no'`. Filtré aux membres **actuels** (cf. `listEventsByGroup`) : le RSVP d'un ex-membre disparaît de la lecture (la ligne reste en base, une ré-invitation le restaure). |

### `polls[]` (`PollDto`)

| Champ                     | Type                                      | Sens                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` / `slug`             | `string`                                  | Identifiants.                                                                                                                                                                                                                     |
| `groupId`                 | `string` (UUID)                           | Groupe parent.                                                                                                                                                                                                                    |
| `tags`                    | `string[]`                                | Tags libres.                                                                                                                                                                                                                      |
| `question`                | `string`                                  | Intitulé du sondage.                                                                                                                                                                                                              |
| `multi`                   | `boolean`                                 | Choix multiple autorisé.                                                                                                                                                                                                          |
| `closesAt`                | `string \| null` (ISO 8601)               | Date de clôture, `null` si sans limite.                                                                                                                                                                                           |
| `options[]`               | `{ id, pollId, label, position, voters }` | Une entrée par option. `voters` est la liste des `userId` ayant voté pour cette option (équivalent aux « votes » du ticket — pas d'horodatage par vote, cf. modèle existant). Filtré aux membres actuels, même règle que `rsvps`. |
| `createdBy`               | `string` (UUID)                           | Créateur.                                                                                                                                                                                                                         |
| `createdAt` / `updatedAt` | `string` (ISO 8601)                       | Horodatages.                                                                                                                                                                                                                      |

### `expenses[]` (`ExpenseDto`)

| Champ                     | Type                                                                | Sens                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id` / `slug`             | `string`                                                            | Identifiants.                                                                                                                                                                                                                              |
| `groupId`                 | `string` (UUID)                                                     | Groupe parent.                                                                                                                                                                                                                             |
| `tags`                    | `string[]`                                                          | Tags libres.                                                                                                                                                                                                                               |
| `description`             | `string`                                                            | Libellé de la dépense.                                                                                                                                                                                                                     |
| `amountCents`             | `number`                                                            | Montant total, en centimes.                                                                                                                                                                                                                |
| `currency`                | `string` (ISO 4217, 3 lettres)                                      | Devise.                                                                                                                                                                                                                                    |
| `paidBy` / `paidByName`   | `string` (UUID) / `string`                                          | Payeur (nom résolu serveur — survit à son départ du groupe, cf. ticket `10af5c92`).                                                                                                                                                        |
| `settledAt`               | `string \| null` (ISO 8601)                                         | Date à laquelle **toutes** les parts sont réglées, `null` sinon.                                                                                                                                                                           |
| `shares[]`                | `{ expenseId, userId, shareCents, isSettled, settledAt, userName }` | Une entrée par participant. **C'est ici que vit le « règlement » (settlement)** : Nexus ne modélise pas de collection `settlements` séparée (pas de table dédiée en base) — `isSettled`/`settledAt` sur la part porte toute l'information. |
| `createdAt` / `updatedAt` | `string` (ISO 8601)                                                 | Horodatages.                                                                                                                                                                                                                               |

### `todoLists[]` (`TodoListDto`)

| Champ                     | Type                                                                     | Sens                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` / `slug`             | `string`                                                                 | Identifiants.                                                                                                                                         |
| `groupId`                 | `string` (UUID)                                                          | Groupe parent.                                                                                                                                        |
| `tags`                    | `string[]`                                                               | Tags libres.                                                                                                                                          |
| `title`                   | `string`                                                                 | Titre de la liste.                                                                                                                                    |
| `items[]`                 | `{ id, listId, text, done, assigneeId, position, createdAt, updatedAt }` | Une entrée par item. `assigneeId` vaut `null` si non assigné, ou si l'assigné a quitté le groupe (remis à `null` en écriture, cf. ticket `2f422033`). |
| `createdBy`               | `string` (UUID)                                                          | Créateur.                                                                                                                                             |
| `createdAt` / `updatedAt` | `string` (ISO 8601)                                                      | Horodatages.                                                                                                                                          |

## Hors périmètre (ADR-027)

Aucun message de messagerie côté serveur : Nexus n'ingère jamais le contenu
des 12 messageries encapsulées (webview), et n'en a donc jamais eu de copie
à exporter.
