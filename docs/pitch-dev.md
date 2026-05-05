# Nexus — Pitch dev

## En une phrase

**Nexus est un client unifié pour Messenger / WhatsApp / Discord, dopé par une couche d'organisation intelligente pour bandes d'amis (events, sondages, dépenses partagées, todos), avec détection d'intention par IA pour transformer une conversation en actions concrètes.**

---

## Le problème

Une bande d'amis vit éclatée entre 3-4 messageries. Pour organiser un week-end, on jongle entre :

- WhatsApp pour le groupe principal
- Messenger pour ceux qui n'ont pas WhatsApp
- Discord pour les sessions gaming
- Doodle pour la date
- Tricount pour les comptes
- Google Calendar pour le rappel
- Notes pour la liste des courses

Chaque outil pris isolément est bon. Mais le contexte est dispersé, les infos perdues, et la friction empêche les groupes peu structurés de s'organiser. Les apps "tout-en-un" existantes sont soit des messageries pures (Beeper, Texts.com), soit des outils d'orga sans messagerie (Tricount, Splitwise).

---

## La solution

Une app desktop + mobile qui :

1. **Agrège les conversations** Messenger / WhatsApp / Discord en un seul flux
2. **Détecte les intentions** dans les messages via Claude API
   - _"on se voit samedi ?"_ → propose un event
   - _"j'ai avancé 50€ pour le resto"_ → propose une dépense partagée
   - _"faut prévoir : pain, vin, chips"_ → propose une liste
3. **Propose des actions inline** validables d'un clic, sans quitter la conv
4. **Centralise l'organisation** : agenda, sondages, comptes, todos, listes — tout reste rattaché au groupe et à la conversation qui l'a généré

---

## Stack

| Couche   | Choix                             | Pourquoi                                               |
| -------- | --------------------------------- | ------------------------------------------------------ |
| Backend  | Node.js + TypeScript, **Fastify** | Perfs (~3x Express), typage natif, validation intégrée |
| DB       | PostgreSQL, Redis                 | Métier classique + cache/pub-sub WS                    |
| Workers  | BullMQ sur Redis                  | Sync messageries, rappels, notifs                      |
| Auth     | JWT + refresh, OAuth              | Standard                                               |
| Desktop  | React + TS + **Tauri**            | ~10 Mo vs 100+ Electron, shell Rust natif              |
| Mobile   | React Native + Expo               | Code partagé via monorepo                              |
| IA       | **API Claude**                    | Détection d'intention en français conv                 |
| Monorepo | pnpm workspaces                   | `@nexus/{backend,desktop,mobile,shared}`               |
| Hosting  | VPS Hostinger (MVP)               | Suffisant pour 100-1000 users                          |

---

## Architecture en deux couches

```
┌─────────────────────────────────────────┐
│  COUCHE ORGANISATION (cœur métier)      │
│  Events │ Polls │ Expenses │ Todos      │
│  + Moteur de détection d'intention IA   │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────┴───────────────────────┐
│  COUCHE MESSAGERIE (plugins)            │
│  Discord │ Messenger │ WhatsApp │ ...   │
│  Interface MessagingProvider unifiée    │
└─────────────────────────────────────────┘
```

Chaque messagerie est un plugin qui implémente `MessagingProvider` (`fetchMessages`, `sendMessage`, `subscribe`, `getContacts`…). On peut ajouter Telegram / Signal / Slack sans toucher au cœur.

---

## Choix techniques structurants

- **Fastify > Express** : perfs, typage, hooks propres
- **Tauri > Electron** : poids, intégration OS
- **Discord = API officielle** : la plus permissive (bot + user RPC)
- **Messenger / WhatsApp = encapsulation web** : on intègre la page web officielle dans une webview avec hooks DOM. Pas de bridge custom (ToS), pas de Graph API limité. L'utilisateur s'authentifie lui-même, on agit côté client uniquement.
- **Claude API > LLM local** : qualité sur le français informel, zéro coût d'infra IA, latence acceptable (<1s)
- **Détection d'intention en JSON structuré** : prompt → sortie validée Zod → action proposée. Fallback silencieux si rien d'actionnable.

Chaque décision structurante est documentée en **ADR** (`.agent/adr/`).

---

## Ce qui est intéressant techniquement

- **Moteur de détection d'intention** : prompt engineering sur du français conversationnel, gestion des faux positifs, opt-in par groupe, dédup pour éviter 3 propositions identiques
- **Abstraction MessagingProvider** : faire entrer 3 modèles très différents (Discord temps réel typé, Messenger Graph polling, WhatsApp webview DOM) dans une interface commune
- **Temps réel** : WebSocket + Redis pub/sub, événements typés (`message:new`, `event:rsvp`, `expense:added`…), reconcile state via TanStack Query
- **Sync multi-device** : desktop + mobile sur le même compte, état partagé sans conflit
- **Design system "Liquid Glass"** type Apple, mapping couleur par feature (events / polls / expenses / todos)

---

## État du projet

Phase pré-MVP. Roadmap MVP :

1. Bootstrap monorepo + auth + DB schema
2. Plugin Discord (le moins risqué)
3. Couche organisation : events + polls + expenses
4. Détection d'intention Claude API
5. Plugin Messenger (encapsulation web)
6. Plugin WhatsApp (encapsulation web)
7. Mobile React Native

---

## FAQ anticipée

### Produit

**"Pourquoi pas Beeper / Texts.com ?"**
Ils agrègent les messageries et s'arrêtent là. Nexus ajoute la couche organisation native, qui est le vrai pain point d'une bande d'amis.

**"Open source ?"**
Pas tranché. Probable : core open-source, plugins messageries séparés.

**"Modèle éco ?"**
Pas la priorité MVP. Pistes : freemium (limites sur nb de groupes / events), self-host pour les techos.

**"Privacy ?"**
Contenus des messages chiffrés at-rest sur le device. Le serveur ne stocke que le métier (events, polls, expenses). IA appliquée aux messages uniquement sur opt-in explicite par groupe.

### Stack

**"Drizzle ou Prisma ?"**
ADR en cours. Drizzle pour le contrôle SQL et le poids, Prisma pour la DX. Penche Drizzle.

**"Pourquoi pas NestJS plutôt que Fastify nu ?"**
Trop de magie pour un MVP. On veut garder le contrôle sur la DI, le routing, la validation. Fastify + Zod + une organisation maison suffit largement à ce stade.

**"Pourquoi pnpm et pas Turborepo / Nx ?"**
pnpm workspaces pour le linking, possible ajout de Turbo pour le caching de build quand le monorepo grossira. YAGNI pour l'instant.

**"Pourquoi Tauri et pas une PWA ?"**
Notifs natives OS, accès filesystem (téléchargements pièces jointes), tray icon, deep linking, intégration calendrier OS. La PWA ne couvre pas tout.

### Risques

**"Les ToS de WhatsApp / Messenger ?"**
C'est précisément pour ça qu'on évite les bridges custom (zone grise). On encapsule la page web officielle, l'utilisateur s'authentifie lui-même, on n'agit que côté client. Aucune réimplémentation du protocole, aucun appel API non documenté.

**"Et si Meta change le DOM de la webview ?"**
Risque réel mais contenu : on a des sélecteurs versionnés, des tests E2E sur la webview, et les changements de DOM côté Meta sont rares (interfaces en place depuis des années). Pire scénario : downtime ponctuel d'un plugin, pas effondrement de l'app.

**"Comment scale ?"**
MVP sur VPS Hostinger, suffisant pour 100-1000 users. Si traction : Postgres managé + Redis Cluster + workers BullMQ horizontaux. Pas d'optim prématurée.

**"Coût Claude API à l'échelle ?"**
La détection d'intention tourne par message, mais on filtre fortement en amont (heuristiques regex pour pré-trier ce qui vaut le coup d'envoyer à Claude). Estimé <0.1$ / user actif / mois sur un usage normal.

### IA

**"Pourquoi pas un modèle local (Llama, Mistral) ?"**
Coût infra (GPU 24/7 vs API à l'usage), qualité moindre sur du français informel, latence comparable une fois packagé. Reconsidéré si la facture Claude devient un sujet.

**"Comment vous évitez les hallucinations ?"**
Sortie JSON strictement schemée (Zod), action toujours **proposée** à l'utilisateur (jamais exécutée auto), tracking des taux de validation pour itérer sur le prompt.

---

## Démo type (1 min)

1. _"Salut les gars on se fait un raclette samedi 19h chez moi ?"_
2. → Bandeau inline : **"Créer l'event 'Raclette' samedi 19h ?"** [Créer] [Ignorer]
3. Click → event créé, RSVP envoyé aux 5 du groupe
4. _"Je passe chez Auchan, je prends quoi ?"_
5. → Bandeau : **"Démarrer une liste de courses ?"** [Oui] [Non]
6. Tout reste rattaché au groupe, visible dans l'onglet "Organisation".
