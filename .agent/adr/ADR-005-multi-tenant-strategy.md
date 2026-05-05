# ADR-005 : Stratégie multi-tenant — groupId dès le départ, pas de tenantId V1

**Date** : 2026-04-30
**Statut** : Accepté

## Contexte

Décision prise avec Manu : MVP en mono-tenant fermé (sa bande d'amis), mais
conception qui doit permettre de basculer multi-tenant SaaS plus tard sans
refactor majeur. Il faut donc trancher dès maintenant la modélisation.

Question : faut-il introduire dès la V1 un concept `tenantId` (orga/workspace)
distinct de `groupId` (bande d'amis), ou bien le `groupId` suffit-il
temporairement comme unité d'isolation ?

## Options envisagées

### 1. tenantId dès la V1

- **Pros** : pas de refacto plus tard, on est prêt
- **Cons** : complexité immédiate sans bénéfice (tous les groupes appartiendront au même tenant en V1), ralentit le MVP

### 2. groupId seul, tenantId ajouté plus tard

- **Pros** : simple en V1, le `groupId` joue déjà le rôle d'unité d'isolation pour les données de groupe (events, sondages, dépenses)
- **Cons** : le jour où on passe SaaS, il faudra ajouter `tenantId` à un certain nombre de tables (users, oauth_connections, refresh_tokens) — migration claire mais à faire

### 3. Schéma pivot via Postgres Row-Level Security (RLS)

- **Pros** : isolation au niveau DB, défense en profondeur
- **Cons** : surcoût d'opération, complexité de debug, mauvaise expérience avec Drizzle ; à reconsidérer en V2 SaaS uniquement si besoin

## Décision

**Option 2 : `groupId` partout dès le départ, pas de `tenantId` en V1.**

Règles d'or appliquées dès maintenant :

1. **Toute table métier liée à un groupe contient `groupId NOT NULL`** :
   `messages`, `events`, `polls`, `expenses`, `todos`, `messaging_channels`, etc.
2. **Toute requête de lecture impose un filtre `groupId`** (helper Drizzle wrappé)
3. **Les tables "globales" en V1 mais "par tenant" en V2** sont identifiées dès maintenant :
   `users`, `oauth_connections`, `refresh_tokens`, `messaging_provider_configs`
   → on prévoit la colonne `tenantId` en migration future, on ne la met pas
   maintenant pour ne pas trimballer du code mort
4. **Aucune jointure cross-groupId** sans audit explicite : un module qui voudrait
   faire ça doit le justifier (cas analytique uniquement)
5. **Les WebSocket events portent `groupId` dans leur payload** (cf. ADR-003) :
   diffusion ciblée par groupe via Redis pub/sub channel `group:{groupId}`

Quand on passera multi-tenant :

- Ajout d'une table `tenants` + colonne `tenantId` sur les tables identifiées ci-dessus
- `groupId` reste l'unité d'isolation pour les données de groupe (un tenant a N groupes)
- Le JWT gagne `tenantId`, les middlewares d'autorisation s'en servent

## Conséquences

**Positif** :

- MVP simple à coder et à raisonner
- Bascule SaaS prévisible, identifiable, faisable en 1-2 sprints le moment venu
- Pas de code mort en V1

**Négatif** :

- Discipline requise : interdire les requêtes sans filtre `groupId` (lint custom ou helpers obligatoires)
- Risque oubli d'index sur `groupId` → on impose dès la V1 des index `(groupId, ...)` sur toute table métier

**Neutre** :

- Backlog : créer une tâche "audit prêt-multi-tenant" à la fin du MVP pour valider que la bascule reste réaliste
- Skill à créer : `add-tenant-scoped-table.md` quand on commencera à multiplier les tables
