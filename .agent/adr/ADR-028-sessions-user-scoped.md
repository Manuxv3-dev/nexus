# ADR-028 : Sessions messageries scopées USER (pas GROUP)

**Date** : 2026-05-04
**Statut** : Accepté

## Contexte

Depuis la refonte initiale (ADR-009 server-side bridges), puis l'ADR-022
(encapsulation webview), puis l'ADR-027 (universalisation 12 providers
webview), le modèle data était :

```
messaging_provider_sessions
  ├─ group_id (FK groups)         ← session liée à un groupe nexus
  ├─ provider_type
  ├─ external_id
  └─ ...
```

Une session représentait *« le compte WhatsApp/Discord/etc. déclaré par
un user pour un groupe nexus précis »*. Conséquence : si un user
appartenait à 5 groupes nexus, il devait re-déclarer 5 fois son compte
WhatsApp (ou plutôt, 5 sessions distinctes pointaient vers le même compte
externe).

C'est une **erreur de conception** identifiée par Manu en testant le flow
desktop : les messageries (Discord, WhatsApp, Slack, etc.) sont
intrinsèquement **propres à la personne**, pas au cercle social. Un user
a son compte WhatsApp, il l'utilise dans tous ses contextes nexus de la
même manière.

Seules les **features** (events, polls, expenses, todos) restent scopées
au groupe — c'est par construction lié à un cercle social précis (un
événement appartient à un groupe d'amis).

## Options envisagées

### A) Garder `group_id`, accepter la duplication

L'user re-déclare son provider pour chaque groupe nexus. Les 5 sessions
sont indépendantes mais pointent en pratique sur le même compte externe.
La contrainte unique `(provider_type, external_id)` côté DB empêche cette
multi-déclaration → 4 des 5 connexions échouent. Bloquant.

### B) `group_id` nullable + sessions "personnelles" sans groupe

Ajouter un mode "session perso non liée à un groupe", coexistant avec les
sessions liées à un groupe. Hybride confus — les users ne comprendraient
pas pourquoi parfois ils doivent choisir un groupe et parfois non. Pas
retenu.

### C) Drop `group_id`, add `user_id` (la session = (user, provider))

Une session est désormais *« le compte WhatsApp/Discord/etc. de cet
utilisateur nexus »*. Indépendant des groupes. La sidebar AppShell
affiche les sessions de l'user courant, peu importe le groupe sélectionné.
Les Settings → Connexions ne nécessitent plus de groupe pré-existant
pour brancher une messagerie.

## Décision

**Option C** — sessions scopées USER. Migration destructive 0009 (validée
par Manu vu le faible volume de sessions de dev) : drop column `group_id`,
add column `user_id NOT NULL FK users(id) ON DELETE CASCADE`. Drop indexes
`group_*`, add index `user_id`. La contrainte unique
`(provider_type, external_id)` reste valide ; pour les sessions webview,
`external_id` passe de `webview:${userId}:${groupId}` à `webview:${userId}`.

Routes backend : nouvelles routes `/api/v1/me/messaging/*` (GET sessions,
POST webview-sessions, DELETE :sessionId). Suppression des anciennes
routes `/api/v1/groups/:groupId/messaging/*`. Plus de `requireGroupRole(admin)` —
juste `requireAuth`.

Frontend : `useMessagingSessions()` no arg, `useConnectWebviewProvider({
providerType })`, `useDeleteMessagingSession({ sessionId, providerType })`.
Hook `useMessagingSessionsByGroup` supprimé. Sidebar AppShell : la liste
"Conversations" est globale user, identique quel que soit le groupe
sélectionné. Plus de pastille couleur provider sur les pills groupe
(l'association session ↔ groupe n'a plus de sens).

GroupHome : section "Conversations connectées" supprimée (n'a plus de
sens ici). La densification (P8) garde 4 Hero cards features (events,
polls, expenses, todos) — les seuls éléments encore scopés au groupe.

## Conséquences

**Positives** :
- Modèle mental clair : messageries = personnel, features = groupe
- Onboarding plus court : un user connecte WhatsApp une fois, c'est valable
  pour toujours dans tous ses contextes
- Plus de friction de permissions (`requireGroupRole(admin)` retiré sur les
  routes messaging — chaque user gère ses propres sessions sans demander
  l'avis du groupe)
- Sidebar plus lisible (plus de dot couleur trompeur sur les pills groupe)

**Négatives** :
- Migration destructive : les sessions existantes en dev sont perdues. Les
  users doivent re-déclarer leurs messageries depuis Settings au prochain
  login. Acceptable vu le stade dev.
- Les ADRs 009, 022, 025, 027 contiennent des références à `group_id`
  qui sont désormais obsolètes (mais conservées pour historique du chemin
  parcouru — chaque ADR garde son `Statut` original, on ne réécrit pas le
  passé).

**Neutres** :
- Le `messaging_channels` reste orphan (déjà inutilisé depuis ADR-027) —
  son ON DELETE CASCADE depuis sessions a vidé la table aussi en passant.
- L'ordre des sessions dans la sidebar est toujours par-user (cf. polish
  P4 révision : localStorage `nx:sessionOrder:${groupId}`). Note : la clé
  inclut encore `groupId` mais l'effet pratique est juste qu'on aura un
  ordre différent par groupe sélectionné — à reconsidérer si on veut un
  ordre vraiment global per-user (clé `nx:sessionOrder` simple). Tracé
  dans backlog.
