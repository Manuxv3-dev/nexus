# ADR-033 : Gestion du compte utilisateur (profil, mot de passe, suppression)

**Date** : 2026-06-02
**Statut** : Accepté

## Contexte

Nexus est une V1 live, mais un utilisateur ne pouvait ni modifier son nom
d'affichage / email, ni changer son mot de passe, ni supprimer son compte :
l'écran Réglages affichait des badges « Bientôt » sur ces actions et aucune
route backend ne les couvrait. C'est un trou fonctionnel **et réglementaire**
(RGPD — droit à l'effacement, art. 17).

Le domaine `auth` exposait déjà `GET /auth/me` et `PATCH /auth/me` (préférences
UI : thème, page d'atterrissage). L'identité (`displayName`, `email`) et le mot
de passe vivent sur la table `users` ; l'unicité email est garantie par l'index
`users_email_lower_idx` (case-insensitive).

Point délicat : **six** FK vers `users.id` sont en `onDelete: 'restrict'` —
`groups.createdBy` (le propriétaire), `events.createdBy`, `polls.createdBy`,
`expenses.paidBy`, `todoLists.createdBy`, `messagingProviderSessions.createdBy`.
Une suppression naïve du user échouerait sur ces contraintes.

## Options envisagées

1. **Nouveau namespace `routes/users` (`PATCH/DELETE /users/me`)** — rejeté :
   le domaine `auth` expose déjà `/auth/me`. Créer un `/users` parallèle
   fragmenterait l'API de l'identité pour rien.
2. **Étendre le domaine `auth`** — retenu : `PATCH /auth/me` accepte en plus
   `displayName`/`email` ; ajout de `POST /auth/change-password` et
   `DELETE /auth/me`. Cohérent, le front consomme déjà `/auth/me`.

Pour la **suppression de compte** (gestion des FK restrict) :

- (a) **Bloquer** si le user possède des groupes/ressources — rejeté :
  incompatible avec le droit à l'effacement.
- (b) **Cascade-delete** tout ce qu'il a créé — rejeté : détruirait des
  groupes vivants et le contenu partagé d'autres membres.
- (c) **Transfert de propriété** au plus ancien autre membre (admin
  prioritaire), suppression du groupe seulement s'il est membre unique —
  retenu : préserve le contenu partagé, comportement le moins surprenant.

## Décision

- **`PATCH /api/v1/auth/me`** étendu : `displayName` (1..80, trim) et `email`
  (valide, unicité case-insensitive → `AUTH_EMAIL_TAKEN` 409, avec rattrapage
  défensif de la violation Postgres 23505). Préférences thème/landing
  inchangées. Renvoie le DTO user à jour. **Pas de CSRF** (on conserve la
  posture historique de cette route ; l'access token Bearer suffit).
- **`POST /api/v1/auth/change-password`** : `{ currentPassword, newPassword }`
  (newPassword réutilise `PasswordSchema`, min 12). Vérifie l'ancien (argon2)
  → `AUTH_INVALID_CREDENTIALS` sinon ; hash le nouveau ; **révoque TOUS les
  refresh tokens** du user. L'access token courant (TTL court) reste valide
  jusqu'à expiration, après quoi un re-login est requis (toutes les sessions
  refresh sont mortes). En mode web → CSRF requis.
- **`DELETE /api/v1/auth/me`** : dans une transaction unique, pour chaque
  groupe que le user touche (membre, propriétaire, ou auteur de contenu
  restrict), on choisit un successeur (rôle owner > admin > member, puis
  `joinedAt` le plus ancien) et on lui transfère la paternité des
  `events/polls/expenses/todoLists` du user dans ce groupe ; si le user
  possède le groupe on lui transfère `groups.createdBy` + le rôle `owner` ;
  si le user est **membre unique**, le groupe est supprimé (cascade). Les
  sessions messageries (user-scoped, ADR-028) sont supprimées. Puis le user
  est supprimé — le reste part en cascade (memberships, refresh tokens, rsvps,
  votes, shares, notifications, prefs, invitations) ou en set null
  (`todoItems.assigneeId`, `activityLog.actorId`). En mode web → CSRF + clear
  cookies. Réponse `{ ok: true }` (200) plutôt que 204, pour rester dans le
  cadre `defineRoute` (validation systématique du reply).

Aucun nouveau code d'erreur : `AUTH_EMAIL_TAKEN`, `AUTH_INVALID_CREDENTIALS`,
`AUTH_NOT_AUTHENTICATED`, `RESOURCE_NOT_FOUND` existent déjà.

## Conséquences

- **Positif** : comble le trou RGPD (effacement) et l'édition d'identité ; les
  4 badges « Bientôt » du SettingsScreen deviennent fonctionnels.
- **Positif** : la suppression préserve les groupes et le contenu partagé tant
  qu'il reste un membre — pas de perte collatérale pour les autres.
- **Négatif** : le changement de mot de passe déconnecte toutes les sessions
  (y compris, à terme, l'appareil courant quand l'access token expire). Choix
  assumé pour la sécurité ; UX atténuée par la durée de vie de l'access token.
  Garder la session courante vivante (révoquer « toutes sauf l'actuelle »)
  reste une amélioration possible si le besoin se confirme.
- **Neutre** : `email` est stocké tel quel (comme à l'inscription), l'unicité
  restant case-insensitive via l'index. Pas de flux de vérification d'email
  (Nexus n'en a pas) — un changement d'email est immédiat.
- **Edge couvert** : le contenu créé par un user dans un groupe qu'il a quitté
  (FK restrict orpheline) est aussi transféré, car la transaction collecte les
  groupes via le contenu authored, pas seulement via les memberships courants.
