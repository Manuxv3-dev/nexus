# ADR-022 : Messenger / WhatsApp = encapsulation webview Tauri (modèle Franz)

**Date** : 2026-05-03
**Statut** : Accepté
**Remplace** : ADR-007 (Messenger via mautrix-meta), ADR-008 (WhatsApp via Baileys)

## Contexte

Les ADR-007 et ADR-008 actaient une intégration Messenger / WhatsApp via des
**bridges auto-hébergés server-side** :

- ADR-007 : `mautrix-meta` (bridge Matrix) pour Messenger
- ADR-008 : `Baileys` (client WhatsApp non officiel) pour WhatsApp

Les deux approches souffraient des mêmes problèmes structurels :

- **Risque ToS Meta non négligeable** : Baileys et mautrix-meta exploitent les
  endpoints non documentés de Meta. Les comptes utilisateurs peuvent être
  bannis. Documenté dans ADR-008 comme "risque assumé".
- **Complexité opérationnelle élevée** : Conduit/Synapse comme homeserver Matrix
  pour mautrix-meta, gestion des sessions WhatsApp pairées dans le temps,
  re-authentification quand Meta change l'API, gestion d'incidents
  d'astreinte.
- **Coût d'infrastructure** : VPS dédiés, services systemd supplémentaires,
  monitoring spécifique (cf. ADR-012 topologie VPS).
- **Maintenance permanente** : les protocoles non officiels changent, il faut
  suivre les mises à jour upstream (Baileys / mautrix-meta) en continu.

Pendant la session 2026-05-03, Manu a observé que **Franz** (et son fork
**Ferdium**) résout élégamment ce problème en utilisant le tag `<webview>`
d'Electron — un guest renderer Chromium qui n'est PAS une iframe HTML
standard et qui **ignore `X-Frame-Options`**. Il spawn un mini-navigateur
intégré pointant vers `web.whatsapp.com` ou `messenger.com`, et c'est
l'utilisateur lui-même qui s'authentifie comme dans n'importe quel browser.
Aucune violation des ToS, zéro maintenance protocolaire, et tous les services
Meta marchent nativement (calls, médias, groupes, réactions, etc.).

**Tauri** (notre runtime desktop choisi par ADR-014) expose la même
capacité via `tauri::webview` (v1) et le multi-webview Tauri v2.

## Options envisagées

### Option A — Maintenir les bridges server-side (ADR-007 / 008)

**Pour** : contrôle total côté serveur, données accessibles à l'intent
detection Claude (pour les features de coordination intelligente),
agrégation cross-canaux possible dans une UI Nexus unifiée.
**Contre** : risque ToS, complexité ops, dette permanente, perte de comptes
utilisateurs probable, scope dev énorme (J7 + J8 = ~3 semaines combinées).

### Option B — Encapsulation webview Tauri (modèle Franz)

**Pour** :
- Zero risque ToS (les utilisateurs ouvrent les apps web officielles)
- Zero maintenance protocolaire (Meta peut faire ce qu'elle veut, ça reste
  son site qui charge)
- Implémentation triviale (pointer une webview vers une URL)
- Modèle éprouvé (Franz, Ferdium, Rambox, Station)
- Gain massif de scope (J7+J8 ramené de ~3 semaines à ~2 jours)
- Pas d'infra additionnelle (pas de Conduit, pas de Synapse, pas de bridges)

**Contre** :
- Pas d'agrégation cross-canaux dans une UI Nexus unifiée pour Messenger/WA
  (chaque app reste isolée dans sa webview, comme Franz)
- Intent detection Claude impossible sans injection JS dans la webview
  (techniquement faisable mais viole les ToS Meta + fragile au DOM Meta)
- Côté **web SPA** : `X-Frame-Options: DENY` empêche l'iframe → décision UX
  à prendre

### Option C — Hybride (bridges pour Discord, webview pour Meta)

C'est de fait la décision actée dans Option B (Discord garde son
implémentation native API ADR-006, Messenger/WA passent en webview).

## Décision

**Option B — Encapsulation webview Tauri (modèle Franz/Ferdium).**

Validation explicite par Manu (2026-05-03) : "n'oublie pas que pour messenger
et whatsapp Nexus doit se contenter d'afficher, en capsuler la page web de
ces applications, ce sera plus simple à gérer", confirmé par questionnaires
multi-choix.

### Spec actée

#### Plateformes ciblées

- **Discord** : reste géré nativement via API officielle bot/user
  (ADR-006 inchangé). Bridge agent + intent detection Claude opèrent
  sur les messages.
- **Messenger** : webview Tauri pointant `https://www.messenger.com`.
- **WhatsApp** : webview Tauri pointant `https://web.whatsapp.com`.

#### Stratégie de rendu côté front

Le `ChatView` du AppShell devient **multi-mode** selon le `providerType` du
channel actif :

```
ChatView
├── ChatViewNative      → Discord (DTO API + composer + thread)
└── ChatViewWebview     → Messenger | WhatsApp (Tauri webview embarquée)
```

Le routing est fait dans le composant parent en fonction du
`provider.type` du channel sélectionné. Chaque mode est implémenté dans
son propre fichier pour rester lisible et testable.

#### Scope web SPA (browser pur)

Le tag `<webview>` Tauri n'existe pas côté browser. `X-Frame-Options: DENY`
sur les domaines Meta empêche tout iframe natif. Trois options envisagées,
**la décision finale sera arbitrée par Manu au moment de l'implémentation
de #11** :

- **Option W1 (recommandée)** : ne pas exposer Messenger/WA dans le web SPA.
  Le rail des groupes ne montre que les sessions Discord pour les users
  connectés via browser. Les sessions Messenger/WA restent visibles mais
  désactivées avec un message "Disponible sur l'app desktop".
- **Option W2** : bouton "ouvrir dans Messenger" / "ouvrir dans WhatsApp"
  qui ouvre l'app officielle dans un nouvel onglet. UX dégradée, mais
  permet à un user web de quand même accéder à ses conversations.
- **Option W3** : proxy reverse qui strip les `X-Frame-Options` headers.
  Fragile (Meta met souvent du frame-busting JS en doublon), juridiquement
  gris (Meta peut estimer que c'est du contournement de leurs protections).
  À éviter.

#### Authentification utilisateur

L'utilisateur s'authentifie **directement dans la webview** comme dans un
browser standard (login Facebook ou QR code WhatsApp Web). Tauri persiste
les cookies entre sessions via son cookie store partagé. Aucun credential
Meta n'est traité ou stocké côté backend Nexus.

#### Notifications

Tauri webview expose les notifications natives du DOM (`Notification` API)
qui sont relayées à l'OS hôte. Le shell Tauri peut agréger les badges
(count d'unread) en lisant le titre de la webview ou via injection JS
non-intrusive (ex. lecture du `document.title`).

#### Killer features (events / polls / expenses / todos)

Restent **partageables via les pages publiques Nexus** (`/e /p /d /t /l`)
par copier-coller du lien dans n'importe quelle conversation Messenger/WA
encapsulée. Pas d'inline integration dans les webviews (cf. décision
"pas d'auto-envoi" ADR-010).

## Conséquences

### Positives

- **Zero risque ToS** sur Messenger/WhatsApp
- **Zero infrastructure** additionnelle requise (pas de Conduit, pas de
  Synapse, pas de Baileys, pas de mautrix-meta)
- **Zero maintenance** des protocoles non officiels (Meta peut changer ce
  qu'elle veut)
- **Gain de scope énorme** : J7 (WhatsApp) et J8 (Messenger) passent de ~3
  semaines combinées à ~2 jours d'implémentation (juste ajouter une webview
  Tauri + l'enregistrer dans la sidebar)
- **Modèle éprouvé** : Franz, Ferdium, Rambox, Station, Beeper Mini ont
  validé cette approche depuis des années
- **Annule** le besoin du POC Conduit + mautrix-meta tracé en blocker
  backlog
- **Annule** la procédure d'astreinte bridges Messenger/WhatsApp tracée
  haute priorité backlog
- **Cohérent** avec la décision macro "true Apple HIG" (ADR-021) — l'app
  s'inscrit dans l'écosystème natif au lieu de réinventer les protocoles

### Négatives

- **Perte de l'agrégation cross-canaux** dans une UI Nexus unifiée pour
  Messenger/WA. Chaque app reste isolée dans sa webview, comme Franz.
  L'unification reste possible **uniquement pour Discord** où on a un
  contrôle programmable.
- **Intent detection Claude inopérante** sur Messenger/WA (pas d'accès au
  contenu des messages dans la webview). La couche "organisation
  intelligente" du pitch Nexus ne s'active que sur les conversations
  Discord. À assumer dans la communication produit.
- **Perte du gros chantier "bridges server-side"** dont l'engineering aurait
  pu produire de la valeur (expérience accumulée Matrix/Baileys). Tradeoff
  acceptable vu le risque ToS.
- **Pas d'archivage messages Messenger/WA** côté Nexus (elle vit dans Meta).
  Les killer features (events, polls, etc.) restent indépendants en DB.

### Neutres

- **ADR-007 et ADR-008 sont marqués "Remplacé par ADR-022"** dans l'index.
  On garde la trace de la décision originale et le contexte qui a justifié
  le pivot.
- **Backlog allégé** : suppression du blocker POC Conduit + mautrix-meta,
  suppression de la procédure d'astreinte bridges Meta, simplification de
  l'ADR-009 (architecture bridges) qui ne concerne plus que Discord.
- **Roadmap J7/J8 à réviser fortement à la baisse** dans `.agent/roadmap.md`
  et `.agent/README.md`.

## Implications opérationnelles

### Côté repo

- **Pas de package Matrix/Baileys** à créer. Les `messaging/whatsapp` et
  `messaging/messenger` sous `packages/backend/src/integrations/` ne seront
  pas implémentés.
- **Pas de schéma DB additionnel** pour les messages bridgés Messenger/WA
  (pas de cache, pas de dédoublonnage — rien ne transite par Nexus).
- Les **sessions Messenger/WA** dans la table `messaging_provider_sessions`
  restent utiles : elles servent juste à enregistrer "le user X a connecté
  Messenger dans le groupe Y". L'authentification réelle se fait dans la
  webview à chaque ouverture (cookie Tauri persistant).
- Le composant `ChatView` doit être refactoré (cf. tâche #11) pour
  supporter les deux modes de rendu.

### Côté VPS Hostinger (cf. ADR-012)

- **Annulation** de la prévision d'installation de Conduit/Synapse + bridges.
- **Aucun nouveau service** systemd à provisionner pour Messenger/WA.
- **Économie nette** : ~2 vCPU + ~2 Go RAM qui auraient été dédiés aux
  bridges restent libres pour autre chose (ou downgrade VPS possible).

### Côté Tauri desktop

- À l'implémentation : créer un composant `<TauriWebView url={...} />` qui
  encapsule l'API Tauri webview natif.
- Configurer le Tauri Tauri config `allowlist` pour autoriser les domaines
  `messenger.com` et `web.whatsapp.com`.
- Tester la persistance cookies entre sessions (devrait fonctionner par
  défaut avec Tauri 2 webview).
