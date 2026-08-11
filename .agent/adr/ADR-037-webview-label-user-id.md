# ADR-037 : label webview dérivé de `user_id`, pas de `session_id` — supersede partiellement ADR-026

**Date** : 2026-08-11
**Statut** : Accepté

## Contexte

ADR-026 (§ "Convention de label") fixe `provider:{provider_type}:{session_id}`
comme identifiant de la partition webview Tauri (`data_directory` — cookies,
cache, session provider). L'intention documentée à l'époque : « permettre à
terme plusieurs comptes WhatsApp dans Nexus desktop, chacun avec son
partition cookie store ».

Relevé pendant la revue de code de MAN-215 (nettoyage des textes obsolètes de
la messagerie), confirmé en investiguant MAN-238 :

- `messaging_provider_sessions.id` est un `uuid().primaryKey().defaultRandom()`
  (`packages/backend/src/db/schema/index.ts`).
- `DELETE /api/v1/me/messaging/sessions/:sessionId` est un **hard delete**
  (`packages/backend/src/routes/messaging/index.ts`).
- `POST /api/v1/me/messaging/webview-sessions` crée la session avec
  `externalId = 'webview:${userId}'`, sous une contrainte d'unicité
  `(provider_type, external_id)` (`messaging_sessions_provider_external_idx`)
  — **un même utilisateur ne peut donc avoir qu'une seule session par
  provider**, déjà appliqué en base, indépendamment de tout schéma de label
  côté webview.

Conséquence du label basé sur `session_id` : déconnecter puis reconnecter le
même provider mint un nouveau `session.id` (hard delete + insert) → un
nouveau label → un `data_directory` Tauri vierge → l'utilisateur doit se
ré-authentifier entièrement (QR code WhatsApp, login Discord…), alors que
« Déconnecter » se présente comme une action locale et réversible côté nexus.

L'aspiration « plusieurs comptes par provider » d'ADR-026 n'a **jamais été
atteignable** avec le schéma actuel : la contrainte d'unicité backend
`(provider_type, external_id)` bloque déjà un deuxième compte du même
provider pour un même utilisateur, quel que soit le schéma de label côté
frontend/Tauri. Le label basé sur `session_id` offrait donc une flexibilité
que le backend n'a jamais permis d'exploiter — au prix d'un bug utilisateur
bien réel (perte de partition à chaque cycle déconnexion/reconnexion).

## Décision

Le label webview est dérivé de `user_id`, pas de `session_id` :

```
provider:{provider_type}:{user_id}
```

- `providerWebviewLabel(providerType, userId)` — `packages/web/src/lib/tauri.ts`.
- Aucun changement côté Rust (`packages/desktop/src-tauri/src/webview.rs`) :
  `sanitize_label` accepte déjà `[A-Za-z0-9._:-]`, et un UUID (hex minuscule +
  tirets) passe sans transformation. Seule la doc du module a été mise à jour
  pour refléter la nouvelle convention.
- Aucun changement de schéma DB : la garantie d'identité stable
  (`externalId = 'webview:${userId}'`, unicité `(provider_type, external_id)`)
  existe déjà côté backend, ce fix se contente de la refléter côté label.

**Migration des partitions existantes : abandon, pas de renommage.** Au
déploiement, toute session desktop actuellement connectée verra son
`data_directory` changer de nom au prochain montage de la webview (ancien
label `session_id`-based → nouveau label `user_id`-based) : une **unique**
ré-authentification résiduelle, puis le label redevient stable pour tous les
cycles suivants. Alternative rejetée : détecter l'ancien dossier et le
renommer au premier lancement. Rejetée parce que :

- Un rename de profil WebView2/Chromium (verrous de fichiers, index de cache
  en cours d'écriture) est plus risqué à faire échouer silencieusement qu'à
  simplement laisser l'ancien dossier orphelin — pour un bénéfice ponctuel
  (économiser une seule ré-authentification aux utilisateurs déjà connectés
  au moment du déploiement).
- Ajoute une commande Tauri dédiée (lister/renommer un dossier hors du
  `data_directory` géré nativement par Tauri) pour un gain qui ne se
  reproduit qu'une fois par utilisateur.
- Le nettoyage des partitions orphelines sur disque est déjà couvert par un
  ticket séparé (« Les partitions webview orphelines ne sont jamais purgées »)
  — l'ancien dossier `session_id`-based rejoint simplement ce même lot, au
  lieu d'ouvrir un second mécanisme de nettoyage ponctuel.

## Conséquences

### Positif

- Reconnecter un provider redevient réellement gratuit (cookies + session
  provider préservés) — cohérent avec la présentation de « Déconnecter »
  comme une action locale, pas une ré-identification forcée chez le
  provider.
- S'appuie sur une garantie déjà existante côté backend (unicité
  `(provider_type, external_id)`) au lieu d'en introduire une nouvelle :
  aucun changement de schéma, aucune nouvelle commande Tauri.
- Referme une tension entre l'aspiration d'ADR-026 (labels par session, pour
  un futur multi-comptes) et la réalité déjà en place côté backend
  (un compte par provider et par utilisateur, imposé) — le label suit
  maintenant ce que le système permet réellement.

### Négatif

- **Coût one-shot au déploiement** : chaque utilisateur desktop actuellement
  connecté à un provider webview devra se ré-authentifier une dernière fois
  au premier lancement post-déploiement (nouveau label, ancien
  `data_directory` orphelin). Pas de fenêtre de maintenance à prévoir — c'est
  transparent par provider, à la prochaine ouverture de son panneau.
- Ferme la porte au multi-comptes par provider pour un même utilisateur nexus
  tant que la contrainte d'unicité backend `(provider_type, external_id)`
  n'est pas elle-même revue — mais cette porte n'était déjà pas ouverte en
  pratique (cf. Contexte).

### Neutre

- Aucun changement de schéma DB, aucune nouvelle dépendance, aucune nouvelle
  commande Tauri.

## Suivi

- Réf. Cortex : MAN-238 (ticket source).
- Supersede la section « Convention de label » d'ADR-026
  (`.agent/adr/ADR-026-tauri-desktop-shell-phase-b.md`, immuable — non
  modifié) : cet ADR fait foi pour la convention de label à partir de
  2026-08-11.
- Validation manuelle desktop requise avant de considérer MAN-238 clos :
  aucun test automatisé ne prouve la réutilisation effective de la partition
  Tauri (jsdom ne simule pas de vrai `data_directory` WebView2). À vérifier
  sur au moins un provider à QR code (WhatsApp) et un provider à login
  classique (Discord) — un cycle déconnexion → reconnexion ne doit plus
  redemander d'authentification.
- Release desktop à couper après merge (le desktop embarque une copie figée
  de `@nexus/web` — un merge sur `main` seul ne livre rien aux utilisateurs
  desktop).
