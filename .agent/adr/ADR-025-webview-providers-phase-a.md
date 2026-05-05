# ADR-025 : Encapsulation WhatsApp/Messenger — Phase A (placeholder web)

**Date** : 2026-05-03
**Statut** : Accepté

## Contexte

L'ADR-022 a tranché : **encapsulation webview** (modèle Franz) plutôt que bridges custom (Baileys/mautrix-meta). Concrètement, l'app Nexus encapsule la page web officielle de chaque provider dans une vue native, et l'authentification se fait chez le provider lui-même (QR code, login). **Aucun token ne transite par notre backend.**

Mais en mode **navigateur web pur** (Vite dev, ou production hébergée), on ne peut pas iframer `web.whatsapp.com` ni `messenger.com` : ces domaines envoient `X-Frame-Options: SAMEORIGIN`, le browser refuse. La vraie encapsulation nécessite une webview native (Tauri desktop, ou React Native WebView mobile).

Le projet n'est pas encore migré sur Tauri (J7-J8 dans la roadmap). Si on attend, l'utilisateur web n'aura accès qu'à Discord pendant des mois. **Manu a demandé une option intermédiaire** pour avancer en parallèle.

## Options envisagées

1. **Attendre Tauri** — pas de WA/Messenger tant que le shell desktop n'est pas livré. Pur, mais repousse de plusieurs semaines.
2. **Iframe avec proxy serveur** — Nexus relaye `web.whatsapp.com` à travers son backend pour bypass `X-Frame-Options`. Marche techniquement mais (a) viole les ToS de Meta, (b) risque de casser à la première mise à jour, (c) complexité backend disproportionnée.
3. **Phase A : placeholder web + Phase B : Tauri** — on prépare toute l'archi (backend, UI, routing) avec un placeholder web qui ouvre le provider dans un nouvel onglet. Quand Tauri arrive, on switche le placeholder en vraie webview sans toucher au reste.

## Décision

**Option 3 (Phase A maintenant + Phase B avec Tauri)**, validée par Manu le 2026-05-03.

### Motivation

- **Démontre la roadmap aux utilisateurs** sans fausse promesse : ils voient WhatsApp/Messenger dans la sidebar, comprennent que c'est branché, comprennent aussi pourquoi ça ouvre dans un nouvel onglet (texte explicatif).
- **Découple le backend du shell desktop** : le modèle de session côté DB est déjà finalisé en Phase A, Tauri ne touchera que le composant `WebviewProviderPane` côté front.
- **Respecte ADR-022** : pas de bridge, pas de token, pas d'OAuth.

## Modèle de session "webview encapsulée"

### Schéma

Pas de migration DB. On réutilise `messaging_sessions` tel quel — le `provider_type` enum a déjà `'whatsapp'` et `'messenger'`. Les sessions de ce type ont les particularités suivantes :

| Champ                   | Valeur convention                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `provider_type`         | `'whatsapp'` ou `'messenger'`                                                                          |
| `external_id`           | `webview:{userId}:{groupId}` (encode (user, group) pour permettre plusieurs users dans le même groupe) |
| `display_name`          | `'WhatsApp Web'` / `'Messenger'`                                                                       |
| `encrypted_credentials` | `null` (jamais stockés)                                                                                |
| `status`                | `'connected'` immédiatement après création                                                             |
| `last_connected_at`     | `now()` au moment de la création                                                                       |

### Lifecycle

1. **Création** : POST `/api/v1/groups/:groupId/messaging/webview-sessions` avec `{ providerType }`. Idempotent : si une session existe déjà pour `(user, group, provider)`, on la renvoie en repinnant `status='connected'`.
2. **Lecture** : la session apparaît dans `GET /messaging/sessions` du groupe (même endpoint que Discord), filtrée côté front via `providerType !== 'discord'`.
3. **Suppression** : DELETE `/messaging/sessions/:sessionId` standard. Le handler skip `publishControl` pour ces providers (pas de bridge worker à notifier).

### Ce qu'on NE fait PAS en Phase A

- Pas de fan-out unread / messages / channels (le backend ne voit jamais le contenu)
- Pas de bridge worker
- Pas de RPC `fetchHistory` / `sendMessage`
- Pas de notifs `notification:created` cross-provider
- Pas d'IA inline sur les messages WA/Messenger

## Architecture frontend

### Composant `WebviewProviderPane`

`packages/web/src/screens/app/WebviewProviderPane.tsx` — rendu quand l'utilisateur sélectionne une session WA/Messenger dans la sidebar.

**Phase A** (mode navigateur) : placeholder explicatif + bouton primaire "Ouvrir WhatsApp/Messenger" (`window.open` vers `web.whatsapp.com` / `messenger.com`) + bouton secondaire "Déconnecter de ce groupe" (delete la session).

**Phase B** (à venir, mode Tauri) : ce même composant détectera `window.__TAURI__` et rendra une vraie WebView native qui encapsule la page directement dans la zone main. Les cookies seront persistés dans un partition cookie store dédié au profil Nexus de l'utilisateur (un partition par session pour permettre plusieurs comptes WA dans Nexus desktop).

### Routing AppShell

Nouveau state `activeWebviewSessionId` dans AppShell. Quand l'utilisateur clique sur une session WA/Messenger dans la sidebar :

- `setActiveWebviewSessionId(s.id)`
- `setActiveChannelId(null)` (les deux sont mutuellement exclusifs)
- `setPane('chat')`

Le rendu main pane devient :

```tsx
{pane === 'chat' && (
  activeWebviewSession ? <WebviewProviderPane session={activeWebviewSession} />
  : activeChannel && sessionId ? <ChatView ... />
  : <EmptyChannel ... />
)}
```

### Sidebar

Les sessions WA/Messenger apparaissent comme des "session cards" dans la liste des conversations du groupe (pas comme des channels — il n'y a pas de channels). Chaque card affiche un dot coloré (vert WA / bleu Messenger) + le nom de la session. Cliquable, devient active visuellement.

## Trade-offs assumés (dette tracée)

- **Sessions scopées par groupe en V1** alors que conceptuellement un user a UN compte WhatsApp pour tous ses groupes Nexus. Conséquence : si l'utilisateur scanne le QR code dans le groupe A, puis veut consulter ses WA dans le groupe B, il doit re-scanner. **À revoir en Phase B** avec une éventuelle table `user_webview_providers` (ou nullable `group_id` sur `messaging_sessions`).
- **Pas de notifications cross-provider** : si un message arrive sur WA pendant que l'utilisateur est dans Nexus mais qu'il regarde le dashboard Events, il ne le verra pas. Limitation acceptable en V1, on documente. Phase B pourra exploiter le titre de l'onglet ("(3) WhatsApp Web") via JS injection dans la webview Tauri pour faire remonter un badge unread.
- **Conformité ToS** : Franz fonctionne ainsi depuis des années sans incident, mais Meta peut un jour décider de bloquer les User-Agents non-browser. **Risque résiduel acceptable.** À monitorer.

## Conséquences

### Positif

- Les utilisateurs voient les 3 providers dès la version web, donc démontre la valeur d'agrégation immédiatement.
- Aucune migration DB — pas de risque en prod.
- Le composant `WebviewProviderPane` est l'unique point qui changera en Phase B, le reste du repo (backend, queries, sidebar, settings) restera intact.
- Pas de dette technique cachée : les choix V1 sont explicitement listés ci-dessus avec leur upgrade path.

### Négatif

- L'expérience web pur est **dégradée** (nouvel onglet) — donc à terme il faudra livrer Tauri pour que la feature soit réellement utile. C'est aligné avec la roadmap mais ça crée une attente côté users.
- Les sessions par groupe créent un faux cas d'usage : l'utilisateur peut "déclarer WhatsApp" sur un groupe sans qu'il y ait de réelle conséquence côté backend. Tracking minimal côté DB → c'est OK.

### Neutre

- L'enum `provider_type` reste à 3 valeurs (`'discord' | 'whatsapp' | 'messenger'`). Pas d'évolution prévue avant un éventuel Telegram/Slack.

## Endpoints exposés

```
POST   /api/v1/groups/:groupId/messaging/webview-sessions   { providerType }
GET    /api/v1/groups/:groupId/messaging/sessions           (déjà existant, filtre côté front)
DELETE /api/v1/groups/:groupId/messaging/sessions/:id       (déjà existant, skip publishControl si !discord)
```

## Migration DB

**Aucune.** L'enum `provider_type` accepte déjà `'whatsapp'` et `'messenger'` depuis 0002.
