# Tâche en cours

**Dernière session** : 2026-06-02 (updater banner #14 + matrix desktop mac/linux #15
+ smoke-test script #8 + constat #16 déjà livré) — ⚠️ NON COMMITÉE (voir ci-dessous)
**Statut repo** : `main` à jour côté origin ; modifs locales 2026-06-02 en attente
de typecheck + commit côté machine Manu (le sandbox agent ne peut pas committer —
mount sans unlink + `index.lock` résiduel).

---

## 🆕 Session 2026-06-02 — bilan (À COMMITTER)

⚠️ **Important** : session menée depuis le sandbox Cowork qui ne peut ni installer
les deps (`pnpm install`) ni committer (filesystem sans unlink). Les fichiers sont
écrits dans le working dir. À faire côté machine Manu :

```bash
pnpm install          # récupère @tauri-apps/plugin-updater + plugin-process
pnpm -w typecheck     # valider TS (web) — pas pu le lancer depuis le sandbox
pnpm -w lint
git add -A && git commit   # cf. messages suggérés plus bas
```

### #14 — Updater banner Tauri (front du plugin updater, ADR-031)

- `packages/web/src/lib/useUpdater.ts` — hook : check au montage (silencieux,
  no-op si `!isTauri()`), state machine `idle→checking→none|available→downloading
  →ready|error`, `install()` = downloadAndInstall + relaunch, `dismiss()`.
  Imports Tauri en **`import()` dynamique** → absents du bundle SPA web.
- `packages/web/src/screens/app/UpdaterBanner.tsx` — banner Liquid Glass haut-centre,
  "Nexus X.Y.Z est disponible" + Installer / Plus tard, barre de progression,
  états ready/error + Réessayer.
- `AppShell.tsx` — `const updater = useUpdater()` + `<UpdaterBanner updater={updater} />`.
- Deps : `packages/web/package.json` + `@tauri-apps/plugin-updater@^2.10.0` &
  `@tauri-apps/plugin-process@^2.3.0`.
- Rust : `Cargo.toml` + `tauri-plugin-process = "2"` ; `lib.rs` register
  `tauri_plugin_process::init()` (cfg desktop only) ; `capabilities/default.json`
  + `process:default` (pour relaunch()).
- Pas de nouvel ADR (couvert par ADR-031). Pas de test unitaire : `@nexus/web`
  n'a pas d'infra vitest (convention — tests côté backend).
- Commit suggéré : `feat(desktop): UpdaterBanner + useUpdater — front du plugin updater Tauri (ADR-031)`

### #15 — Builds macOS + Linux desktop

- `.github/workflows/desktop-release.yml` — matrix mac+linux dé-commentée
  (windows-latest, macos-latest arm64, macos-13 x64, ubuntu-22.04). **Ajout
  step "Install Linux system deps"** (webkit2gtk-4.1, appindicator3, rsvg2,
  patchelf, gtk-3) gated `matrix.platform == 'ubuntu-22.04'` — sinon build
  ubuntu rouge.
- macOS/Linux produits **NON SIGNÉS** en V1 (cohérent ADR-031 / parti pris
  SmartScreen Windows). Cert Apple reste "plus tard / si feedback".
- Landing : **aucune modif nécessaire** — la card Desktop affichait déjà
  Windows/macOS/Linux en `available: true`. iOS/Android restent "Bientôt".
- Pas testé (CI uniquement). Le prochain tag `desktop-v*` buildra les 4 cibles.
- Commit suggéré : `ci(desktop): active la matrix macOS + Linux (deps système ubuntu)`

### #8 — Smoke test prod

- `scripts/smoke-test.mjs` — E2E Node (fetch, Bearer) : health, auth
  (login si `SMOKE_EMAIL`/`SMOKE_PASSWORD` sinon register éphémère), groups,
  events+RSVP, polls+vote, expenses+settle, todos+check, 4 pages publiques.
  Cleanup du groupe créé (cascade) en fin de run. Payloads/paths alignés sur
  les schemas Zod réels du backend.
- ✅ **Exécuté par Manu le 2026-06-02 : 17/17 assertions vertes** contre la
  prod live (health, auth, groups, events+RSVP, polls+vote, expenses+settle,
  todos+check, 4 pages publiques). La prod est saine sur tout le happy-path.
  Bug initial du cleanup (DELETE avec content-type mais body vide → 400)
  corrigé : le helper `api` ne pose plus `content-type` sans body. Un groupe
  smoke orphelin (`b23ca839…`) traîne en prod suite au run buggé — inoffensif.
- Ne couvre pas (manuel) : WS push multi-user, desktop Windows (login/WS/
  webviews/banner updater), timing worker rappels BullMQ.
- Commit suggéré : `test(prod): script smoke-test E2E des features killer (#8)`

### #16 — Notifications transverses V1.2 → DÉJÀ LIVRÉ

Constat : #16 a été **entièrement implémenté et commité** dans des sessions
précédentes (les notes qui le donnaient "à démarrer" étaient périmées). Présent :
table `notifications` (migration `0005`), routes `routes/notifications/`
(GET/read/read-all/DELETE) dans `server.ts`, producteurs events/expenses/todos +
worker reminders, WS `notification:created` (6 kinds), front `NotificationsBell` +
panel + queries optimistic dans `AppShell`, ADR-023. → **Rien à faire** sinon
valider via smoke/manuel.

---

## 📌 Session précédente 2026-05-08 (release desktop Windows v0.1.0 + iter landing) — clôturée 🟢🚀
**Statut repo** : `main` à jour, pipelines CI/CD opérationnels (deploy + desktop-release)
**Statut VPS** : prod up — backend + workers + landing + SPA web servis
**Statut desktop** : binaire Windows v0.1.0 publié sur GitHub Releases avec auto-updater Tauri
**URLs live** :
- https://nexusapp.chat (landing)
- https://app.nexusapp.chat (SPA web)
- https://api.nexusapp.chat (backend + WS)
- https://github.com/Manuxv3-dev/nexus/releases/latest (binaires desktop)

---

## 🎉 Session 2026-05-08 — bilan

Session longue (post-déploiement initial) qui a livré 3 chantiers majeurs :

### Bloc 1 — Refonte landing (3 itérations)

1. **Iter 1 — copie conforme app + 12 providers**
   - `MockupConnect`, `MockupUnifiedDashboard`, `MockupGroupHome` refondus
     pour reproduire la structure visuelle de l'app prod (cf. screenshots
     Manu).
   - `PROVIDERS_LIST` étendu de 3 à 12 services (Messenger, WhatsApp,
     Discord, MS Teams, Instagram, Snapchat, TikTok, Reddit, X, LinkedIn,
     Slack, Telegram).
   - `ProviderIcon` helper avec couleurs marque + initiales (en attendant
     les SVG simpleicons).
   - User stories "Les potes" / "Famille" évoquées dans la narration.
   - Bug fix : `goToLogin` → URL absolue cross-domain, Footer "Se
     connecter" idem.

2. **Iter 2 — événements en première ligne**
   - SHOWCASE_STEPS étape 02 : « Discute / Messenger embedded » remplacé
     par « Planifie / Tes événements sans relancer 5 fois » →
     `MockupEvents`.
   - SHOWCASE_STEPS étape 05 : « Sync / Multi-device » remplacé par
     « Réponds / RSVP en 30 sec » → `MockupEventDetail`.
   - `MockupEvents` : header + tabs + card PROCHAIN avec countdown 4
     cellules + pie SVG RSVP + liste 3 événements à venir avec status
     badges.
   - `MockupEventDetail` : modal centrée sur backdrop flouté + RSVP
     buttons (Oui/Peut-être/Non/Effacer) + participants + actions footer.
   - Données fictives partout (Apéro chez Léa, Trail des Calanques,
     Marseille, Mathis, Toi, Brunch dimanche).
   - Suppression `MockupUnifiedDashboard` et `MockupMultiDevice`
     (préservés via git history).
   - `MockupGroupHome` refait fidèle screenshot prod (helper `FeatureCard`
     extrait pour les 4 cards events/polls/expenses/todos).

3. **Iter 3 — copy + spacing + alternation**
   - Hero copy mise à jour : "...Discord, WhatsApp, Messenger,
     Instagram et bien d'autres..." (12 providers évoqués) + ton
     tu→vous, "organiser entre amis".
   - Boutons Hero rééquilibrés : "Télécharger l'app" elevated + border +
     glow hover ; "Se connecter" outlined pill primary + filled hover.
     Hiérarchie 3 niveaux claire.
   - Espacements verticaux ~50% : Hero 120/80 → 100/48px, Step minHeight
     70vh retiré, gap entre Steps 60-100px → 16-32px, Downloads et
     Footer paddings serrés.
   - Section "Pas de waitlist" supprimée (`CtaFinal` retiré + dead code
     éliminé).
   - Séparateurs gris retirés : `borderTop` Downloads + Footer + connecteur
     vertical entre Steps.
   - Alternation text/image fixée 2 fois :
     - 1er fix raté : `order` sur des divs internes à `<Reveal>` (pas
       enfants directs du grid → ignoré).
     - 2e fix OK : wrapper div direct du grid porte `order`, Reveal
       hérite naturellement.
   - Mockups écrasés/déformés résolus : `minWidth: 0` retiré, sortie du
     centrage flex du chemin de sizing (wrapper en block, flex centrage
     interne à Reveal).

### Bloc 2 — Pipeline release Tauri Windows v0.1.0 (ADR-031)

- **API/WS URLs configurables** :
  - `packages/web/src/lib/api.ts` : `API_BASE` lit
    `import.meta.env.VITE_API_BASE` (default `/api/v1` pour build web,
    override absolu pour Tauri).
  - `packages/web/src/lib/ws.ts` : URL WS lit `VITE_WS_BASE` (default
    `wss://${host}/ws`).
- **Versions bumpées 0.0.0 → 0.1.0** dans `packages/desktop/package.json`,
  `Cargo.toml`, `tauri.conf.json`.
- **Plugin updater Tauri** :
  - `Cargo.toml` : `tauri-plugin-updater = "2"` cfg-gated desktop only
    (pas iOS/Android).
  - `lib.rs` : registration cfg-gated.
  - `capabilities/default.json` : `updater:default`.
  - `tauri.conf.json` : section `plugins.updater` avec endpoint GitHub
    Releases + pubkey + `installMode: passive` Windows.
- **Workflow CI** : `.github/workflows/desktop-release.yml` (matrix
  Windows V1, mac+linux commentés), `tauri-action@v0`, injection
  `VITE_API_BASE` + `VITE_WS_BASE` pointant sur api.nexusapp.chat.
- **Setup signing fait par Manu** :
  - `tauri signer generate -w ~/.tauri/nexus-updater.key` + password.
  - Pubkey collée dans `tauri.conf.json`.
  - Secrets GitHub posés : `TAURI_SIGNING_PRIVATE_KEY` +
    `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- **Release publiée** : tag `desktop-v0.1.0` push → workflow OK → release
  GitHub avec `.exe` + `.msi` + `latest.json` signé.
- **Bug CORS Tauri** découvert au premier login : preflight OPTIONS sur
  `api.nexusapp.chat` retournait 404 parce que l'origin
  `http://tauri.localhost` n'était pas allowlistée. Fix dans `server.ts` :
  allowlist explicite incluant `{http,https}://tauri.localhost` +
  `tauri://localhost` + apex domains.
- **ADR-031** rédigé (décisions : pas de cert, GitHub Releases, updater
  Tauri natif, Windows V1, matrix mac+linux commentée).

### Bloc 3 — Cleanup ADR-027 (universalisation webview)

Découvert que tout le boulot d'implémentation d'ADR-027 (lots 2-6) avait
été fait dans des sessions précédentes :
- ✅ Migration DB `0007_extend_provider_type.sql` (9 nouvelles values
  enum)
- ✅ `BrandIcon` 12 providers (simpleicons.org SVG paths)
- ✅ `PROVIDER_WEB_URL` 12 entries
- ✅ `PROVIDER_META` 12 entries (descriptions UI)
- ✅ `WEBVIEW_PROVIDERS` Settings 12 cards
- ✅ Discord migration : `ChatView.tsx` supprimé, `integrations/discord/`
  supprimé, `workers/discord-bridge.ts` supprimé, routes channels/messages
  supprimées (cf. migrations 0010-0012).
- 🟡 Reste un commentaire mort ligne 20 de `scripts/dev-start.bat`
  (cleanup trivial → tâche #17).

---

## ✅ État live de la prod

```
URL backend         : https://api.nexusapp.chat/api/v1/health
URL pages publiques : https://nexusapp.chat/{e,p,d,t,l}/<slug>
URL landing         : https://nexusapp.chat (SSR statique via Caddy)
URL SPA web         : https://app.nexusapp.chat (Caddy SPA fallback)
URL desktop         : https://github.com/Manuxv3-dev/nexus/releases/latest

Cert TLS            : Let's Encrypt via Traefik (mytlschallenge,
                      réutilisé du compose root Hostinger)
DB                  : Postgres 16 (volume nexus-pgdata, 14 migrations
                      appliquées)
Cache/queues        : Redis 7 (volume nexus-redis-data, internal-only)
Workers BullMQ      : nexus-worker-reminders + nexus-worker-purge
Image courante      : ghcr.io/manuxv3-dev/nexus-backend:<sha-récente>
                      + tag :latest
Static web          : caddy:2-alpine sur app.nexusapp.chat
Static landing      : caddy:2-alpine sur nexusapp.chat (apex)
Desktop binary      : Nexus_0.1.0_x64-setup.exe + .msi sur GitHub
                      Releases (Windows uniquement V1)
```

---

## 🚀 Reprise — prochaines sessions

### Court terme (ordre de priorité)

1. **Validation prod post-deploy + smoke tests** (tâche #8 — toujours
   pending). Checklist :
   - Login + register sur `app.nexusapp.chat`
   - Créer un groupe
   - Créer un événement, RSVP avec un autre user, vérifier WS push
   - Créer un sondage, voter
   - Créer une dépense, settle
   - Créer un todo, assigner, cocher
   - Vérifier les rappels d'event (worker BullMQ)
   - Test des pages publiques `/e`, `/p`, `/d`, `/t`, `/l`
   - Test desktop Windows : login OK, WS connecte, providers webview se
     chargent (Discord/WhatsApp/Telegram/etc.)
2. **Frontend updater banner** (tâche #14) — câbler le déclenchement
   front du plugin updater Tauri. UI : banner "Nexus 0.1.1 dispo —
   Installer / Plus tard". Hook `useUpdater` + composant
   `UpdaterBanner` intégré dans AppShell.
3. **Système de notifications transverses V1.2** (tâche #16) — décidé
   2026-05-03, scope full repris dans `backlog.md`. ADR-032 à rédiger en
   début d'implémentation.

### Moyen terme

4. **macOS + Linux desktop builds** (tâche #15) — dé-commenter la
   matrix dans `desktop-release.yml`. 3 plateformes cible (mac Intel,
   mac Apple Silicon, linux x64). Mise à jour landing Downloads section
   pour passer iOS/Android de "Bientôt" → "Disponible" pour macOS/Linux.
5. **Cleanup dev-start.bat** (tâche #17) — retirer le commentaire mort
   "Worker Discord" ligne 20. Trivial.

### Plus tard / si feedback réel

6. **Code-signing Windows EV** — uniquement si feedback users sur
   SmartScreen warning bloque trop. ~400-600€/an + clé USB.
7. **Cert Apple Developer** — si on veut macOS sans Gatekeeper warning.
   ~99$/an.

### TODO post-V1 — durcissement Traefik

(inchangé depuis 2026-05-07 — cf. `.agent/notes/traefik-existing.md`)

- Désactiver `--api.insecure=true`, basic-auth middleware sur dashboard
- Remplacer email LE placeholder par vrai email Manu
- Access logs Traefik avec rotation
- Optionnel HTTP/3
- Figer image Traefik (`traefik:v3.x` au lieu de `latest`)

---

## 📦 Workflows CI/CD en place

### `deploy.yml` — backend + landing + SPA web

Trigger : push sur `main` avec touches dans `packages/backend/**`,
`packages/shared/**`, `packages/web/**`, `packages/landing/**`,
`Dockerfile`, `infra/**`, `pnpm-lock.yaml`, `package.json`,
`turbo.json`, `tsconfig.base.json`, `.github/workflows/deploy.yml`.

Jobs :
1. `build` — Build image multi-stage backend → push GHCR
2. `build-frontend` — Build SPA web + landing → rsync vers
   `/opt/nexus/static/{web,landing}/`
3. `sync-infra` — SCP compose + deploy.sh + Caddyfiles + .env example
4. `deploy` — Run `deploy.sh` sur le VPS + healthcheck externe

Manuel : Actions → deploy → Run workflow avec input `image_tag`.

### `desktop-release.yml` — desktop Tauri Windows

Trigger : push d'un tag `desktop-v*` (ex `desktop-v0.1.0`) OU
`workflow_dispatch`.

Job unique avec matrix (Windows actif, mac+linux commentés). Output :
`.exe` + `.msi` + `latest.json` signé sur GitHub Release auto-créée à
partir du tag.

Tag/release manuel :

```powershell
git tag desktop-v0.1.1
git push origin desktop-v0.1.1
```

---

## Blockers

Aucun bloquant. Tout est prêt pour les prochaines sessions.
