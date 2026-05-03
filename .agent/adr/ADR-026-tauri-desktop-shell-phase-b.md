# ADR-026 : Shell desktop Tauri 2 — Phase B encapsulation WhatsApp/Messenger

**Date** : 2026-05-03
**Statut** : Accepté

## Contexte

L'ADR-025 a livré la **Phase A** de l'encapsulation WhatsApp/Messenger : un
placeholder web qui ouvre la page provider dans un nouvel onglet via
`window.open`. C'est dégradé mais ça permet d'avancer sur le frontend
sans bloquer sur Tauri.

Pour aboutir à la promesse produit (Discord/WA/Messenger dans **une seule
app**, sans changer d'onglet), il faut un **shell natif** capable
d'encapsuler `web.whatsapp.com` et `messenger.com` directement dans la
fenêtre principale. Les browsers refusent l'iframe (X-Frame-Options:
SAMEORIGIN) — la solution standard est une webview native (modèle Franz,
Slack, Beeper, etc.).

## Options envisagées

### Quelle technologie de shell ?

1. **Electron** — la référence historique (Slack, Discord, VSCode). Mature,
   doc abondante. Mais binaire ~150MB (Chromium embarqué), RAM ~300MB
   minimum, perf moyennes. Choix par défaut "facile" mais lourd.
2. **Tauri 2** — Rust + WebView native (WKWebView macOS, WebView2 Windows,
   WebKitGTK Linux). Binaire ~10-15MB, RAM ~50-100MB, perf natives. API
   multi-webview native depuis 2.0. Mobile (iOS/Android) supporté dès la
   même base.
3. **Wails** (Go + WebView native) — alternative Go. Plus mince
   communauté que Tauri, pas de mobile, peu d'expérience interne en Go.
4. **PWA + window.open ad infinitum** — pas de shell, on dit "ouvrez
   chaque provider dans son onglet". Inacceptable produit.

### Tauri 1.x vs Tauri 2.x

- **1.x** : mature, beaucoup de tutos. Multi-webview = workaround par
  fenêtres séparées. Migration vers 2.x à terme inévitable.
- **2.x** : sortie fin 2024. API multi-webview native (exactement ce dont
  on a besoin), permission system plus granulaire, support mobile unifié.
  Doc complète mais plus récente.

### Architecture multi-webview

- **Embedded dans la window principale** : WA/Messenger s'affichent dans
  la zone main de Nexus, comme aujourd'hui le ChatView. Switch via la
  sidebar. Une seule fenêtre Nexus, expérience cohérente.
- **Fenêtres séparées par provider** : chaque provider ouvre une fenêtre
  native (style Slack qui pop un canal). Plus simple à implémenter mais
  multi-window UX moins fluide pour notre cible (gens qui veulent tout
  voir en un coup d'œil).

## Décision

- **Tauri 2.x** : seule option qui supporte multi-webview natif sans hack
  + mobile dans la même base + binaire mince
- **Webviews embedded** dans la window principale Nexus
- **macOS + Windows** en V1 (Linux reporté faute d'utilisateurs)
- **Pas de code signing en V1** : Gatekeeper/SmartScreen affichent un
  avertissement au 1er lancement, acceptable pour beta privée. Coût
  signing reporté à launch (Apple Dev 99€/an + Windows EV cert ~300€/an)

## Architecture

```
packages/desktop/
├── package.json              (@tauri-apps/cli + scripts wrapper)
├── README.md                 (setup Rust, comment dev, comment build)
└── src-tauri/
    ├── Cargo.toml            (tauri 2, plugin-shell, serde)
    ├── tauri.conf.json       (window, beforeDevCommand, frontendDist)
    ├── build.rs              (tauri-build)
    ├── capabilities/
    │   └── default.json      (core:default + webview create/resize/close)
    └── src/
        ├── main.rs           (entry point natif, appelle lib::run)
        ├── lib.rs            (Tauri Builder + invoke_handler)
        └── webview.rs        (commandes webview providers)
```

Le **frontend React reste 100% dans `@nexus/web`** — Tauri le charge via
`devUrl: http://localhost:5173` en dev ou `frontendDist: ../../web/dist`
en build. Aucun code React dupliqué.

### Commandes Rust exposées (cf. `webview.rs`)

| Commande | Effet |
|---|---|
| `create_provider_webview({label, url, bounds})` | Crée une webview enfant attachée à la window principale, avec `data_directory` dédié (cookies isolés). Idempotent. |
| `set_provider_webview_bounds({label, bounds})` | Resize/repositionne (à appeler depuis ResizeObserver côté front). |
| `set_provider_webview_visible({label, visible, bounds?})` | Hide (déplace hors-écran) ou show (repositionne). Préserve cookies + DOM. |
| `destroy_provider_webview({label})` | Ferme la webview. Le `data_directory` est conservé sur disque. |

**Convention de label** : `provider:{providerType}:{sessionId}` — le
label encode (provider, session) pour permettre à terme plusieurs comptes
WhatsApp dans Nexus desktop (chacun avec son partition cookie store).

**Sécurité** :
- Validation `https://` only sur l'URL (refuse `file://`, `tauri://`)
- Sanitization du label (regex `[a-z0-9._:-]+`) avant usage en path
- `data_directory` sous `app_data_dir()` Tauri (résolu par OS, pas
  accessible aux autres apps)

### Frontend (cf. `packages/web/src/lib/tauri.ts`)

Helpers TypeScript qui wrappent `@tauri-apps/api/core::invoke` :

```ts
isTauri(): boolean
providerWebviewLabel(provider, sessionId): string
PROVIDER_WEB_URL: { whatsapp: '...', messenger: '...' }

createProviderWebview({ label, url, bounds }): Promise<void>
setProviderWebviewBounds({ label, bounds }): Promise<void>
setProviderWebviewVisible({ label, visible, bounds? }): Promise<void>
destroyProviderWebview(label): Promise<void>
```

En mode navigateur web pur, `isTauri()` renvoie `false` et tous les
helpers no-op silencieusement → le code est safe en dev sans Tauri.

### Composant `WebviewProviderPane` (mode dual)

```
┌──────────────────────────┬─────────────────────────────────────┐
│ Mode navigateur web pur  │ Mode Nexus Desktop (Tauri)          │
├──────────────────────────┼─────────────────────────────────────┤
│ <WebPlaceholder />       │ <TauriWebviewMount />               │
│   - Hero logo + texte    │   - <div ref={containerRef} />       │
│   - Bouton "Ouvrir       │   - useEffect mount :                │
│     [provider]" (open    │     · createProviderWebview(...)     │
│     dans nouvel onglet)  │     · ResizeObserver → setBounds()   │
│   - Bouton "Déconnecter" │     · scroll/resize listeners        │
│                          │   - useEffect cleanup :              │
│                          │     · destroyProviderWebview(label)  │
└──────────────────────────┴─────────────────────────────────────┘
```

La détection se fait dans `WebviewProviderPane` qui retourne le sous-
composant approprié.

### Cookie persistence et sessions WhatsApp

- Chaque session a son propre `data_directory` (`{appData}/webviews/provider__whatsapp__{sessionId}/`)
- Au create : si le dossier existe (re-mount d'une session déjà connectée),
  les cookies sont restaurés → l'user n'a pas à re-scanner le QR
- Au destroy (unmount du composant) : les cookies restent sur disque
- "Logout" complet (perte de session WhatsApp côté Nexus) = delete la
  session via Settings → on supprimera le `data_directory` correspondant
  côté Rust (commande à ajouter en V1.1 si besoin)

## Trade-offs assumés

### Positif

- **Binaire ~10-15MB** vs 150MB pour Electron — ergonomie download
- **RAM ~50-100MB** au lieu de ~300MB — multi-tenant friendly
- **Mobile inclus dans la roadmap** : Tauri 2 unifie desktop et mobile, le
  même `lib::run()` peut être réutilisé pour iOS/Android (J9-J10)
- **Webviews natives** = perf chat/UI proche de l'app native officielle
  (pas d'overhead Chromium)

### Négatif

- **Toolchain Rust requise** côté dev (curve d'apprentissage si on doit
  toucher au code Rust). Le user final n'a rien à installer.
- **Tauri 2 est jeune** (released fin 2024) — risques de bugs sur
  l'API multi-webview (je l'ai déjà vu avoir des soucis sur le sizing
  webviews enfants en bêta). À surveiller, fallback possible vers fenêtres
  séparées si bloquant.
- **Perte du DOM state au switch de pane** (V1) : quand l'user passe de
  WhatsApp à Events puis revient, la page WA se re-load (mais cookies
  préservés → re-load instantané). Si gênant à l'usage, on passera
  au pattern hide/show (V1.1).
- **Pas de signing V1** : avertissement Gatekeeper/SmartScreen au 1er
  lancement. Acceptable beta, à régler avant launch public.

### Neutre

- Dépendances natives Linux (libwebkit2gtk-4.1-dev) : géré au cas par
  cas, V1 ne cible pas Linux.

## Roadmap consécutive

- **Phase B1** (cette ADR) : scaffolding + commandes webview + bind
  frontend → tu peux lancer `pnpm tauri:dev` et avoir une vraie webview
  WA dans la zone main
- **Phase B2** : générer les icônes (PNG 1024 + `tauri icon`) + premier
  build NSIS Windows + DMG macOS
- **Phase B3** : code signing (Apple Dev cert + Windows EV cert) avant
  publication publique
- **Phase B4** : auto-update via le plugin `tauri-plugin-updater` quand
  on a une URL de release stable

## Conséquences sur le code existant

- `WebviewProviderPane.tsx` : refactor en deux sous-composants
  (`WebPlaceholder` + `TauriWebviewMount`). API publique inchangée.
- `packages/web/package.json` : ajout `@tauri-apps/api: ^2.1.1`
- `packages/desktop/` : reprise du dossier placeholder existant (J4),
  mise à jour `package.json` + ajout `src-tauri/`
- `package.json` racine : 3 nouveaux scripts `tauri:dev`, `tauri:build`,
  `tauri:build:debug` qui filtrent vers `@nexus/desktop`

## Migration et compatibilité

- Le frontend reste **100% web-compatible** : `pnpm --filter @nexus/web dev`
  marche toujours, pas de régression. Les sessions WA/Messenger
  retombent sur le placeholder en mode web (Phase A).
- Pas de migration DB.
- Pas de breaking change côté API backend (les routes
  `/messaging/webview-sessions` de Phase A restent identiques).
