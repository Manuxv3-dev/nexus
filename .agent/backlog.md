# Backlog Nexus — tâches en attente, idées, dettes

Mis à jour : 2026-04-30 (rév. 3 : bascule bridges server-side, VPS rouge à nouveau).

Format : `[priorité] description — contexte` où `priorité` ∈ {🔴 blocker, 🟠 haute, 🟡 moyenne, 🟢 faible}.

## Blockers (à résoudre avant déploiement V1)

- ✅ **vps-inventory** — Résolu 2026-04-30. KVM 2 Hostinger, Ubuntu 24.04,
  2 vCPU, 8 Go RAM, 100 Go disque, France/Paris. Largement dimensionné. État
  détaillé dans `.agent/notes/vps-hostinger.md`.
- 🔴 **valider le pack d'ADR fondateurs (001-010)** — validation groupée par
  Manu requise avant de démarrer le J0. Spécialement attention sur :
  - ADR-007/008 (assomption du risque ToS Meta)
  - ADR-009 (architecture bridges server-side)
  - ADR-010 (interdiction d'auto-envoi)
- 🔴 **POC Conduit + mautrix-meta** — à faire en début de J8 avant déploiement
  prod. Si Conduit pose un problème de compat, fallback Synapse (RAM x2).

## Système de notifications transverses (V1.2 — décidé 2026-05-03)

- 🟠 **Système de notifications persistées + panneau in-app** — décidé par
  Manu suite à la livraison de #42 : le toast `event:reminder` est éphémère
  (8s, perdu si l'user n'est pas online). Il faut un historique consultable.

  **Spec actée** :
  - **Scope V1** : rappels d'events (h24/h1) + RSVP demandés sur un event
    + expenses ajoutées au groupe + todos assignées à l'user. Pas les
    messages bridges (Discord) en V1 — risque de bruit, viendra plus tard
    avec règles fines (mute par channel, mention only, etc.).
  - **Rétention** : 30 jours puis purge auto via job BullMQ nocturne.
  - **Lecture** : manuel au clic sur une notif + bouton « tout marquer lu »
    (pattern Slack/Discord). Pas d'auto-read au montage du panneau.
  - **Architecture cible** :
    - Table `notifications (id, user_id, kind, payload jsonb, group_id,
      source_id, created_at, read_at nullable)`
    - Endpoints `GET /api/v1/notifications?unread=&limit=&cursor=`,
      `POST /:id/read`, `POST /read-all`
    - WS event `notification:created` (pousse la notif fraîche aux
      sessions WS du user concerné)
    - UI : icône cloche dans la sidebar avec badge count d'unread +
      panneau dropdown listant les notifs avec CTA contextuel par `kind`
    - Le toast `event:reminder` actuel reste comme feedback éphémère
      complémentaire — la notif est aussi insérée en DB pour consultation
      différée.
  - **Producteurs à câbler** :
    - Worker `event-reminders` : insert notif en DB en plus du WS publish
    - Routes mutations : `expenses POST` (notif aux co-payeurs), `todos
      PATCH assignee` (notif au nouvel assigné), `events POST` (notif
      "RSVP demandé" aux members)
  - **Production** : nouveau service `nexus-worker-purge-notifications` à
    provisionner sur le VPS (très léger, 1 job/nuit) — à intégrer ADR-012.

  À démarrer **après** #44 (tests d'intégration) et l'ADR de remplacement
  Messenger/WA. ADR à rédiger en début d'implémentation (probablement
  ADR-022, ADR-021 étant le pivot Messenger/WA).

## Pivot architectural à acter (2026-05-03)

- 🟠 **Rédiger ADR de remplacement pour Messenger/WhatsApp = encapsulation web
  (modèle Franz/Ferdium)** (invalide ADR-007 + ADR-008). Décidé par Manu le
  2026-05-03 : on n'implémente pas Baileys ni mautrix-meta, on encapsule la
  page web officielle (web.whatsapp.com, messenger.com) dans une webview Tauri
  sur le modèle de Franz (qui utilise le tag `<webview>` Electron, équivalent
  Tauri natif).

  Points à traiter dans l'ADR :
  - **Desktop Tauri** : encapsulation triviale via `tauri::webview` (le tag
    `<webview>` ignore `X-Frame-Options` parce que ce n'est pas une iframe
    HTML standard, c'est un guest renderer Chromium). Pattern Franz validé.
  - **Web SPA** : iframe reste bloquée. Arbitrer entre (a) Discord-only sur
    web, (b) bouton "ouvrir dans nouvel onglet", (c) proxy reverse strip
    headers (fragile + juridiquement gris).
  - **Features transverses Franz-style** OK : sidebar unifiée, notifs
    agrégées, badges, switcher comptes, raccourcis globaux — tout ce qui
    vit dans le shell Tauri.
  - **Intent detection Claude impossible** sur Messenger/WA sans injection
    JS dans la webview (viole ToS Meta + fragile). V1 : zéro lecture du
    contenu, alignement strict Franz.
  - **Killer features** restent partageables via pages publiques
    `/e /p /d /t /l` par copie-collé dans n'importe quelle conversation.
  - **Annule** le POC Conduit + mautrix-meta et le blocker associé.
  - **Annule** la procédure d'astreinte bridges Messenger/WhatsApp.
  - **Réduit fortement** le scope J7 (WhatsApp) et J8 (Messenger) →
    roadmap à réviser après l'ADR.

  À rédiger après livraison de #42 (cette session) ou en début de session
  suivante.

## Dettes mineures introduites session 2026-05-04 — ✅ TOUT LIVRÉ session 2026-05-05

- ✅ ~~Migration 0009 : drop `display_order`~~ — réalisé via migration 0009
  (M1 sessions user-scoped) qui a fait le drop au passage en cascade.
- ✅ ~~Migration 0010 : drop `messaging_channels` table~~ — livré 2026-05-05.
  Schema TS retire `messagingChannels` + `messagingMessages` + `channelType`.
  Migration 0010 générée par drizzle-kit (DROP TABLEs CASCADE + DROP CONSTRAINT
  channel_id_fk dans events/polls/expenses/todo_lists + DROP TYPE channel_type).
- ✅ ~~Migration 0011 : drop `messaging_provider_sessions.encrypted_credentials`~~
  — livré 2026-05-05. Migration 0011 + cleanup `session-store.ts` + DTOs.
- ✅ ~~Unifier clé localStorage session-order per-user~~ — livré 2026-05-05.
  `nx:sessionOrder:${groupId}` → `nx:sessionOrder` user-global avec migration
  legacy hydratant la nouvelle clé depuis la 1re ancienne entrée trouvée.
- ✅ ~~Nettoyer backlog des items chat-programmable obsolètes~~ — livré
  2026-05-05 (cf. section "Ajustements UX/ergo — session 2026-05-01" plus
  bas, nettoyée).

## Dettes nouvelles introduites session 2026-05-05 — cleanup léger

- ✅ ~~Drop colonnes `channel_id` orphelines + cleanup code~~ — livré
  2026-05-05. Migration 0012 (DROP COLUMN IF EXISTS × 4 tables). Code
  backend (12 fichiers events/polls/expenses/todos × schemas+repo+index)
  + web (queries.ts, public/hooks.ts, AppShell.tsx + LS_LAST_CHANNEL +
  state activeChannelId) entièrement nettoyé.
- ✅ ~~Drop module `integrations/core/encryption.ts`~~ — livré 2026-05-05.
  Module + test à `git rm` côté Windows (mount sandbox ne permet pas le
  delete). Var env `ENCRYPTION_KEY_BRIDGES` + `PROVIDER_SESSIONS_KEY`
  retirées de `core/env.ts` + `.env.example`. README `integrations/`
  réécrit pour refléter l'archi post-ADR-027.
- ✅ ~~`LS_LAST_CHANNEL` legacy à drop~~ — livré 2026-05-05 avec le drop
  des colonnes channel_id (cleanup en bloc).

## Polish post-ADR-027 — webview messaging (session 2026-05-04) ✅ TOUT LIVRÉ

> **Tous les items ci-dessous ont été livrés dans la session 2026-05-04.**
> Conservés ici pour traçabilité — voir `.agent/current-task.md` pour le
> récap consolidé et l'état runtime à valider.

Issus du test desktop Tauri après livraison ADR-027 (12 providers webview).
Pas bloquant pour le commit ADR-027, à reprendre dans une session dédiée
"Polish webview UX" (probablement avant l'attaque V1.2 notifs transverses).

- 🟠 **Webviews persistantes — pas de reload à chaque bascule provider** :
  actuellement `WebviewProviderPane` fait `createProviderWebview` au mount
  et `destroyProviderWebview` au unmount, donc switcher de Discord vers
  WhatsApp détruit la webview Discord et la recharge la prochaine fois
  (perte du scroll, ré-auth WA via QR code, latence visible). Il faut
  passer à un modèle « créer une fois, hide/show ensuite » : garder les
  webviews vivantes au niveau du shell Tauri, juste les masquer via
  `setProviderWebviewBounds({ width: 0, height: 0 })` ou un flag visibility
  côté Rust. Suppression effective uniquement au DELETE de la session.
  Touche : `packages/desktop/src-tauri/src/webview.rs` + Pane.tsx + AppShell.

- 🟠 **Contrôles fenêtre flottants en surimpression de la webview** : avec
  `decorations: false` (window borderless, #45) on a perdu min/max/close
  natifs. Le custom titlebar n'est pas la solution voulue par Manu — il
  faut afficher les boutons en overlay flottant (top-right, glass blur,
  petit rayon) directement par-dessus la webview, sans bandeau dédié.
  Touche : `packages/desktop/src-tauri/tauri.conf.json` + nouveau composant
  React `WindowControlsOverlay` rendu au niveau racine du shell Tauri,
  z-index supérieur aux webviews enfants. Côté Rust, exposer
  `window.minimize() / .toggle_maximize() / .close()` via commands.

- 🟠 **Bypass landing page en mode Tauri — boot direct sur /login** : dans
  l'app desktop, l'user n'a aucune raison de voir la landing publique
  marketing. Au boot Tauri, si pas de session, redirect direct vers
  `/login` (au lieu de `/`). Touche : `router.tsx` détection `isTauri()`
  + redirect au niveau du root route.

- 🟡 **Réordonnancement des providers dans le volet conversations** :
  actuellement l'ordre des sessions dans la sidebar suit l'ordre de
  création (ordre DB par `createdAt`). L'user doit pouvoir drag&drop
  pour réorganiser (ex : mettre Discord au-dessus de WhatsApp). Stockage :
  champ `display_order` (smallint) sur `messaging_provider_sessions` +
  endpoint `PATCH /sessions/reorder`. UI : drag handle ou long-press.

- 🟡 **Logos officiels providers dans Settings → Connexions messageries** :
  dans la page Paramètres, chaque `ConnectionCard` affiche dans la pastille
  ronde (40×40, fond `accentBg`) la première lettre du nom du provider via
  `{provider.charAt(0)}` (cf. `SettingsScreen.tsx:945`) — donc « D » pour
  Discord, « W » pour WhatsApp, « M » pour Messenger ET Microsoft Teams
  (collision visuelle), « L » pour LinkedIn, « S » pour Slack/Snapchat
  (autre collision), etc. À remplacer par le composant `BrandIcon` qui
  contient déjà les 12 logos officiels (cf. ADR-027 / U2).
  Touche : `ConnectionCard` doit accepter une prop `brandKey: BrandKey`
  optionnelle, et la `WEBVIEW_PROVIDERS.map()` la passe à partir de `p.id`.
  Garder le fond coloré `accentBg` derrière, en mode monochrome
  (`colored=false`) ou couleur native du brand selon le rendu visuel.

- 🟡 **Réduire largeur sidebar AppShell** : la sidebar fait 280px ; les 4
  feature buttons (Events / Polls / Expenses / Todos) tiennent largement
  sur une ligne avec marge. Réduire à la valeur minimale qui garde les
  4 boutons sur une ligne propre (probablement ~240-250px). Touche :
  `AppShell.tsx` Sidebar `width: 280` → recalculer + tester sur tous les
  écrans (mobile responsive non concerné, MobileShell séparé).

- 🟠 **Déplacer cloche notif + bouton réglages près du nom d'utilisateur** :
  actuellement `NotificationsBell` + bouton `gear` Settings sont dans le
  HEADER de la sidebar (à côté du wordmark "nexus"). Manu veut les voir
  en BAS de la sidebar, à côté de l'avatar / nom (footer profil). Touche :
  `AppShell.tsx` — déplacer les 2 boutons depuis le bloc header (ligne
  ~530-600) vers le bloc footer profil (ligne ~810-820). Garder le
  comportement (badge unread, dropdown notifs, navigate /settings).

- 🟠 **Indicateur "Home Nexus" actif : cadre léger au lieu de fond bleu** :
  le bouton logo+wordmark Nexus dans le header sidebar passe en fond
  `NX.primaryMuted` (bleu pâle) quand `pane === 'home'`. Manu trouve ça
  trop chargé visuellement. Remplacer par un cadre léger (ex
  `border: 0.5px solid NX.primaryMuted` ou `outline`) sans fill. Toucher
  juste le `style.background` conditionnel ligne ~537.

- 🟠 **Clic sur l'icône d'un groupe → ouvre une "home de groupe" dédiée** :
  actuellement `onSelectGroup` fait `setPane('chat')` directement, ce qui
  ouvre la dernière webview ou le placeholder « sélectionne une
  conversation ». Manu veut une vraie vue d'accueil par groupe, à
  concevoir : tableau de bord du groupe (events à venir, sondages
  ouverts, soldes dépenses, todos assignées DANS ce groupe, accès rapide
  aux conversations connectées). Touche :
  - Nouveau pane `'group_home'` dans le type `Pane`
  - Nouveau composant `GroupHomeDashboard.tsx` (mirror de `HomeDashboard`
    mais scopé au groupe actif au lieu du feed cross-groupes)
  - `onSelectGroup` → `setPane('group_home')` (au lieu de `'chat'`)
  - Endpoint backend probablement déjà couvert par les
    `useEvents/usePolls/useExpenses/useTodos` qui sont déjà scopés
    au `activeGroupId` — à vérifier au moment de l'implémentation.

- 🟡 **Densifier les dashboards Home Nexus + GroupHome (qualité > quantité)** :
  les deux dashboards (cross-groupes et par-groupe) doivent être plus
  peuplés visuellement, MAIS avec du contenu pertinent — pas de doublons
  ni de remplissage cosmétique. Idées de blocs additionnels à arbitrer
  au moment du design :
  - Calendrier mini-vue (semaine en cours + prochains 7j) avec dots
    par event
  - Activité récente cross-feature (qui a fait quoi récemment)
  - Suggestions IA (intent detection sur messages → "Tu pourrais créer
    un event à partir de cette discussion ?")
  - Récap dépenses : qui doit combien à qui en un coup d'œil
  - Sondages en attente de vote (pas encore voté par moi)
  À cadrer dans une mini-spec quand on attaque, pour éviter le bullshit
  visuel. Pré-requis : le clic sur groupe ouvre group_home (item ci-dessus).

## Branding & icons — état (2026-05-05)

- ✅ ~~Logo / icônes pas optimisés multi-échelles~~ — étape 1+2 livrées
  2026-05-05. 4 SVG masters dans `assets/branding/`, script de génération
  `scripts/icons-generate.{sh,ps1}`, skill `regenerate-icons.md`,
  assets pixel-perfect placés (Tauri icon.ico 7 tailles, web favicon
  multi-format, manifest PWA, apple-touch-icon, maskable).
- 🟢 **Étape 3 — vérif visuelle multi-cibles** : Manu doit rebuild Tauri
  et valider taskbar Windows / Alt-Tab / Start menu / favicon onglet /
  apple-touch / PWA installée. Cf. checklist dans
  `.agent/skills/regenerate-icons.md`.
- 🟢 **Pas de `.icns` macOS** : sandbox sans `iconutil`/`png2icns`. Tauri
  CLI sait le générer au build sur mac (ou installer `apt install
  icnsutils` côté Manu si dev WSL). Pas bloquant V1.
- 🟢 **Wordmark utilise `<text>`** : rendu PNG dépend de la font system.
  Convertir le `<text>` en `<path>` via Inkscape quand le wordmark est
  figé (cf. `assets/branding/README.md`).
- 🟡 **Externalisation design pro avant launch public** : option A
  pragmatique mais "amateur". Brief à un designer (Fiverr/Upwork
  ~50-300€) recommandé avant V1 public pour identité durable. Master
  AI/SVG livré → regénération auto via le script.
- 🟢 **Microsoft Store assets MSIX** : à ajouter au script quand on
  attaque le packaging Store (V1.2+). Snippet d'extension préparé dans
  `.agent/skills/regenerate-icons.md` section "Ajouter une nouvelle
  déclinaison".

## Haute priorité (à intégrer dès le début de l'implémentation)

- 🟠 Décider du gestionnaire de secrets (env file `.env` pour MVP suffisant ;
  Doppler / Infisical / Vault à reconsidérer si on ouvre l'équipe).
- 🟠 Politique de logs : que loguer (jamais de PII messages bridgés en clair),
  rotation, durée de rétention.
- 🟠 Politique de purge des messages bridgés (proposition par défaut : 30 jours).
- 🟠 CI : configurer un cache pour `pnpm install` et Turborepo remote cache
  (gratuit jusqu'à un certain volume).
- ~~🟠 Procédure d'astreinte légère pour les bridges Messenger/WhatsApp~~ :
  obsolète depuis ADR-027 (plus de bridges server-side, tout est en
  webview Tauri côté client).
- ~~🟠 Rotation de la clé `PROVIDER_SESSIONS_KEY`~~ : obsolète depuis
  migration 0011 (plus de credentials chiffrés en DB).
- 🟠 **vps-cohabitation-n8n** — au déploiement V1 (J9), organiser la cohabitation
  Nexus/n8n : reverse proxy partagé (vhosts), allocation des ports, séparation
  des bases de données, durcissement firewall UFW. Documenter dans
  `docker-compose.prod.yml`.
- 🟠 Audit firewall UFW du VPS (actuellement 0 règles côté Hostinger), création
  utilisateur non-root, désactivation login root par mot de passe, fail2ban —
  à faire avant J9.

## Moyenne priorité (à reprendre après MVP)

- 🟡 Skill `auth-refresh-flow.md` à rédiger quand on implémentera J1 (auth)
- 🟡 Skill `integrate-bridge-discord.md` à rédiger pendant J3
- 🟡 Skill `integrate-bridge-baileys.md` à rédiger pendant J7
- 🟡 Skill `integrate-bridge-mautrix.md` à rédiger pendant J8
- 🟡 Skill `add-public-page-route.md` à rédiger pendant J5
- 🟡 Skill `add-tenant-scoped-table.md` quand on commencera à multiplier les
  tables (rappel ADR-005)
- 🟡 Audit "prêt-multi-tenant" en fin de MVP (J9)
- 🟡 Évaluer la mise en place d'OpenTelemetry / un APM léger (Tempo / Grafana)
  une fois la prod stable
- 🟡 Internationalisation (i18n) — démarrer en français uniquement, prévoir
  l'extraction des chaînes desktop dès J4 pour ne pas avoir à refacto
- 🟡 Smoke test prod quotidien : healthcheck de chaque bridge, alerte si
  KO > 5 min (cf. ADR-009)
- 🟡 Plan de rotation périodique des clés de chiffrement sessions

## Faible priorité / idées à conserver

- 🟢 Nexus comme client Matrix natif — pivot envisageable en V2+
  (l'archi avec Conduit + mautrix-* facilite la transition)
- 🟢 Plugin marketplace pour intégrations tierces (Spotify partagé, Strava
  groupe, etc.)
- 🟢 Mode "vacances" : tableau de bord d'un voyage groupe (events + dépenses +
  todos + photos partagées)
- 🟢 Export d'un groupe vers JSON (RGPD + sauvegarde personnelle)
- 🟢 Mode hors ligne basique côté desktop (cache TanStack Query persistent)
- 🟢 Raccourcisseur d'URL maison (`nx.app/e/abc`) pour des liens plus courts
  dans les messageries
- 🟢 Universal Links / App Links iOS+Android (V2.0 mobile)
- 🟢 Acheter un domaine custom pour Nexus (ex: `nexus.app`, `nexusapp.fr`)
  une fois la V1 stable — pour le MVP on reste sur `srv1068104.hstgr.cloud`

## Bugs résolus 2026-05-02 (à archiver)

- ✅ **Modal stale après mutation killer features** : les dashboards
  Events/Polls/Expenses/Todos stockaient l'objet (event/poll/expense/list)
  figé dans le state au moment du clic ouvrant la modal. Après un re-fetch
  TanStack Query, la modal continuait d'afficher l'ancienne version. Fix
  pattern « stocker l'ID, lookup à chaque render » dans les 4 dashboards.
- ✅ **`AUTH_REFRESH_REUSED` au boot en dev** : `useAuth.init()` était
  appelé en parallèle par React StrictMode (double-mount), envoyant deux
  POST `/auth/refresh` simultanés avec le même refresh token → le backend
  considérait le 2e comme un token reuse et révoquait toutes les sessions.
  Symptôme : pages publiques `/d/:slug` etc qui ne reconnaissaient plus
  l'user connecté. Fix : déduplication `initInFlight` sur le pattern de
  `refreshInFlight` (cf. `packages/web/src/lib/auth.ts`).

## Dettes techniques tracées

- 🟠 **J5 — remplacer le store in-memory killer features** (introduit par
  ADR-016, commit `feat(web): bundle design implementation`).
  - `packages/backend/src/routes/killer-features/store.ts` : RAM seed,
    perdu au restart. À remplacer par tables Drizzle (`events`, `polls`,
    `poll_options`, `poll_votes`, `expenses`, `expense_shares`, `todo_lists`,
    `todo_items`).
  - Endpoints stubs : actuellement seuls les GET sont exposés. Mutations
    manquantes : POST RSVP, POST vote, POST/PATCH/DELETE expense, POST/PATCH/
    DELETE todo item, POST/PATCH event.
  - WS events à propager (cf. `ws-protocol.ts`) : `event:created/updated/
    rsvp`, `poll:created/voted`, `expense:added/settled`, `todo:added/checked`.
  - Worker BullMQ pour les rappels d'événements (J5b).
- 🟠 **J5b — durcir tsconfig @nexus/web pour activer `tsc --noEmit`** :
    actuellement `pnpm typecheck` est skippé côté `@nexus/web` car ~150
    erreurs strict mode (paths `@/*` non résolus, `exactOptionalPropertyTypes`
    sur certains composants, types zustand stricts sur les setters partiels).
    Le code tourne en dev (Vite bypass tsc) et en build (`tsc -b` via
    `vite build`), donc la dette est contenue. À traiter avant J5 final :
    1. Ajouter `baseUrl` + `paths` dans `packages/web/tsconfig.json` (alias
       `@/*` → `src/*` comme déjà fait en `vite.config.ts`).
    2. Soit relâcher `exactOptionalPropertyTypes` dans le tsconfig web
       uniquement, soit aligner les composants (préférer la 2e).
    3. Rétablir `"typecheck": "tsc --noEmit"` dans `packages/web/package.json`.
- 🟠 **J5 — remplacer le store in-memory waitlist** (introduit par
  ADR-016, `packages/backend/src/routes/waitlist/index.ts`). Migrer vers
  table `waitlist` Drizzle avec dédoublonnage par email.
- 🟡 **J4b-bis — partager les schémas Zod killer features via
  @nexus/shared** : actuellement `packages/web/src/lib/queries.ts` redéfinit
  les schémas localement. Dès que J5 les rend stables, les exposer depuis
  `@nexus/shared` et importer côté front. Au passage, faire pareil pour
  `GroupDtoSchema` / `GroupMemberDtoSchema` : on a déjà eu un schema
  mismatch en démo (front attendait `slug`/`ownerId` qui n'existent pas
  dans le DTO backend) — partager le schema en supprimerait la classe.
- 🟡 **J4b-bis — endpoint `GET /groups?withMemberCount=true`** : le DTO
  `GroupDtoSchema` n'inclut pas le nombre de membres. Pour la liste de
  groupes (rail desktop, liste mobile), on aimerait l'avoir sans devoir
  appeler `GET /groups/:id/members` pour chaque entrée. À ajouter en
  query param optionnelle.
- 🟡 **Tests visuels / e2e côté @nexus/web** : Playwright recommandé,
  scope J4c. Couvrir au minimum : login → onboarding → app shell → switch
  group → ouvrir un panel feature.
- 🟢 **Hooks killer features front silencieux sur 404** : actuellement
  retournent un tableau vide en cas d'erreur. Pratique pour les groupes
  vides, mais masque les erreurs réseau. À reconsidérer en J4c avec
  React Query devtools + bandeau d'erreur global.
- 🟢 **Theme switcher fonctionnel** : `SettingsScreen.ProfileSection`
  permet de basculer dark/light/auto via `data-theme`, mais il n'y a pas
  de persistance (zustand store ou cookie). À ajouter en J4b-bis.
- 🟢 **Persister la waitlist** : voir J5.
- 🟠 **Idempotency-key sur sendMessage RPC** : actuellement un retry HTTP
  après `RPC_TIMEOUT` peut créer un doublon de message côté Discord. V2 :
  ajouter une `idempotency-key` côté client + table `messaging_send_log`
  côté worker pour dédoublonner. Faible probabilité en pratique (worker
  local en dev, latence < 200ms), mais à fixer avant production publique.
- 🟡 **Circuit breaker bridge-rpc** : si le worker est down, toutes les
  requêtes timeout après 5s — UX cassée. Ajouter un compteur de timeouts
  par provider, et répondre `RPC_BRIDGE_UNAVAILABLE` (503) immédiatement
  après N timeouts consécutifs jusqu'à un healthcheck OK.
- 🟡 **Tests d'intégration bridge-rpc** : Redis + worker stub + assertions
  sur fetchHistory/sendMessage. À ajouter en J3.5 monitoring.
- 🟡 **Pool de clients Redis subscribers RPC** : actuellement chaque
  `requestRpc` ouvre un client Redis subscriber jetable. Pas un problème
  à notre échelle (≤ 100 sessions), mais à pooliser si on monte en charge.
- 🟢 **Métriques RPC** : `bridge_rpc_request_total`, `_duration_seconds`,
  `_timeout_total` par provider/op. À ajouter avec OpenTelemetry en V2.
- 🟠 **J9 — SSR meta-tag injection pour pages publiques** (cf. ADR-018) :
    pour que Slack, Twitter (X) et autres crawlers no-JS voient les balises
    Open Graph sur les liens partagés, ajouter une route Fastify catch-all
    `/e/*`, `/p/*`, `/d/*`, `/t/*`, `/l/*` qui :
    1. Fetch la ressource par slug
    2. Lit `dist/index.html` du build SPA
    3. Injecte les meta tags via remplacement de placeholders
    4. Renvoie le HTML modifié
    Caddy route ces paths vers le backend, le reste vers les statics SPA.
    Discord/WhatsApp/iMessage/Telegram (cibles principales) marchent dès
    J5a sans cette route — c'est juste pour les crawlers anciens.
- 🟢 **Persister les messages en DB** (V2 majeur) : actuellement
  l'historique est lu live via RPC à chaque fetch. Pour le mode offline
  PWA (J4c), il faudra persister `messaging_messages` côté worker
  (`MessageCreate` event → INSERT) et lire la DB côté HTTP. Big refactor,
  à arbitrer en ADR dédié.

## Ajustements UX/ergo — session 2026-05-01 (curé 2026-05-05 post-ADR-027)

Identifiés en testant Discord de bout en bout. La majorité des items
"Frontend SPA" visaient un chat natif Nexus qui n'existe plus depuis
ADR-027 (universalisation webview) — on ne touche plus le DOM des
messages, donc composer/scroll/attachments/réactions/mentions/dates
relatives sont obsolètes. Items conservés ici = ceux toujours
pertinents post-ADR-027/028.

### Frontend SPA (curé)

- 🟢 **Rail des groupes : pas de bouton "+"** pour créer un nouveau groupe
  une fois qu'on est dans `/app`. Le placeholder dashed existait dans le
  prototype design mais a disparu de mon impl. À ré-ajouter avec un modal
  de création.
- 🟢 **Toast `bridgeToast` qui se duplique** : `AppShell` ET `SettingsScreen`
  écoutent tous les deux le `BroadcastChannel` et affichent un toast. Si
  les deux onglets sont ouverts, l'utilisateur voit deux toasts. Centraliser
  le toast au niveau du provider racine.
- 🟢 **Theme dark/clair non persisté** : `SettingsScreen` change `data-theme`
  mais reload = retour à dark. Ajouter persistance localStorage + restore
  au boot dans `main.tsx`.
- 🟢 **Empty states génériques** : "Aucun groupe", "Sélectionne une conversation"
  ont juste du texte. Améliorer avec illustration + CTA explicite.

### Popup OAuth

- 🟡 **Popup OAuth qui reste ouverte sur `/oauth/callback` standalone** :
  comportement Firefox/Chrome avec COOP cross-origin. La popup affiche
  "Tu peux fermer cet onglet" mais ne se ferme pas auto. Pas de fix navigateur
  possible — juste documenter clairement côté UI. Note : depuis ADR-027 on
  n'utilise plus l'OAuth ; ce flow est latent (utile si on rebranche un
  provider non-webview à terme).
- 🟢 **Settings : pas d'auto-cleanup des popups orphelines** : si
  l'utilisateur ferme l'onglet parent pendant l'OAuth, la popup reste vivante
  et son `BroadcastChannel` n'a personne pour écouter. Pas critique mais
  pourrait être joliment géré.

### Connexions messageries

- 🟢 **Pas de retry manuel sur sessions en `error`** : la carte affiche
  l'erreur mais pas de bouton "Réessayer". Pertinent depuis ADR-027 si une
  webview échoue à se créer (data_directory FS error, etc.).

### Réception temps réel

- 🟢 **Notifications natives pas câblées** : le platform provider est en
  place (`@nexus/platform-web`) mais n'est appelé nulle part. À câbler
  dans le `useWs.onEvent` quand l'app n'est pas focused. Spécialement
  utile pour les events `notification:created` (cf. ADR-023).

### Auth / Profil

- 🟡 **`PATCH /users/me` n'existe pas** : Profil → Nom d'affichage / Email /
  Mot de passe affichent un badge "Bientôt". Endpoints à créer côté backend
  (J1f).
- 🟡 **`DELETE /users/me` n'existe pas** : pareil, "Supprimer mon compte"
  est stub.
- 🟢 **Pas de persistance des préférences notifications** : les toggles dans
  `NotificationsSection` n'envoient rien au backend. Endpoint
  `GET/PATCH /users/me/notifications` à créer + table `user_notif_prefs`.

### Backend / observabilité

- 🟡 **Logs structurés trop verbeux par défaut** : chaque request HTTP log
  un `incoming request` + `request completed`. En dev c'est OK, en prod ça
  pollue. Filtrer les routes `/health` et configurer un sampling.
- 🟢 **Pas de healthcheck du worker** : le HTTP ne sait pas si le worker
  est up. Quand on appelera J3.5 (CI/CD prod), ajouter un endpoint
  `/health/bridges` qui ping chaque worker via Redis pub/sub.

## Questions ouvertes

- Faut-il un bot Discord slash-commands pour piloter Nexus depuis Discord ?
  (ex: `/nexus event create`) — à reconsidérer après J5
- Stratégie de notifications push mobile en V2 — APNs / FCM via Expo ?
- Faut-il un onboarding guidé dans le desktop (J4) ou on assume que Manu et
  ses amis le testent en mode "tech demo" ?
- Open Graph cards : générer côté backend Node (Satori) ou via service tiers
  (@vercel/og en self-hosted, ou cloudinary) ? Décision pendant J5.
- Cas du téléphone WhatsApp éteint : politique de notification utilisateur,
  fréquence du healthcheck, message d'erreur user-friendly.
- ADR-010 : faut-il prévoir un mode "post automatique opt-in explicite" pour
  les utilisateurs qui veulent ce comportement ? Si oui, dans quel ADR
  successeur, et avec quelles garanties ToS ?
