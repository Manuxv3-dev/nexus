# @nexus/desktop — Shell Tauri 2

App native macOS / Windows / Linux qui héberge le frontend `@nexus/web` et
fournit les capacités natives requises pour la **vraie encapsulation
WhatsApp/Messenger** (cf. ADR-022 + ADR-026).

## Setup initial (une fois par machine)

### 1. Toolchain Rust

**macOS**

```bash
brew install rustup
rustup-init -y
rustup default stable
```

**Windows**

```powershell
winget install Rustlang.Rustup
rustup default stable
```

Puis installer Visual Studio Build Tools (Tauri en a besoin pour linker) :

- Soit via [Visual Studio Installer](https://visualstudio.microsoft.com/downloads/) → "Desktop development with C++"
- Soit `winget install Microsoft.VisualStudio.2022.BuildTools` puis cocher C++

**Linux (Debian/Ubuntu)**

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Vérifier l'installation

```bash
rustc --version    # ≥ 1.70
cargo --version
```

### 3. Installer les deps JS

```bash
# Depuis la racine du monorepo
pnpm install
```

Cela installe `@tauri-apps/cli` dans `packages/desktop/node_modules/.bin/`.

### 4. (Optionnel mais nécessaire pour `tauri build`) Générer les icônes

`tauri build` exige `icon.icns`, `icon.ico` et plusieurs PNG. Pour les
générer depuis un PNG source 1024×1024 :

```bash
cd packages/desktop
pnpm tauri icon path/vers/source-1024.png
```

Tauri populera `src-tauri/icons/` automatiquement.

`tauri dev` n'a **pas besoin** des icônes — tu peux travailler sans tant
que tu ne builds pas pour distribution.

## Lancer en dev

Depuis la racine du monorepo :

```bash
pnpm tauri:dev
```

Cela exécute :

1. `pnpm --filter @nexus/web dev` (Vite, port 5173) — déclenché par
   `beforeDevCommand` dans `tauri.conf.json`
2. `cargo run` qui compile + ouvre la fenêtre native pointant sur `http://localhost:5173`

Premier lancement : ~2-5 min de compilation Rust (les builds suivants
sont incrémentaux, ~10-30s).

## Builder pour distribution

```bash
pnpm tauri:build
```

Génère :

- **macOS** : `.app` + `.dmg` dans `packages/desktop/src-tauri/target/release/bundle/`
- **Windows** : `.exe` (NSIS installer) + `.msi` dans le même dossier
- **Linux** : `.deb`, `.AppImage`

Sans code signing (cf. ADR-026, V1) :

- macOS : Gatekeeper avertira au 1er lancement (clic droit → Ouvrir)
- Windows : SmartScreen avertira (Plus d'infos → Exécuter quand même)

## Architecture

```
packages/desktop/
├── package.json          # @tauri-apps/cli + scripts wrapper
├── README.md             # ce fichier
└── src-tauri/
    ├── Cargo.toml        # deps Rust (tauri 2.x, plugin-shell, serde)
    ├── tauri.conf.json   # config window, build, bundle
    ├── build.rs          # invoque tauri-build
    ├── capabilities/
    │   └── default.json  # permissions Tauri 2 (webview create/resize/close)
    └── src/
        ├── main.rs       # entry point — appelle nexus_lib::run()
        ├── lib.rs        # builder Tauri + register handlers
        └── webview.rs    # commandes Rust create/resize/destroy webviews providers
```

Le **frontend React reste dans `@nexus/web`** — Tauri le charge via
`devUrl` (dev) ou `frontendDist: ../../web/dist` (build). Pas de code
React dupliqué côté desktop.

## Comment ça marche en runtime

1. Au démarrage, Tauri ouvre la window principale et charge le frontend
   (Vite ou dist).
2. Le frontend détecte qu'il tourne dans Tauri via `window.__TAURI_INTERNALS__`
   (cf. `packages/web/src/lib/tauri.ts → isTauri()`).
3. Quand l'user clique sur une session WhatsApp/Messenger dans la sidebar,
   `WebviewProviderPane` (mode Tauri) appelle `create_provider_webview`
   qui crée une **webview enfant native** au-dessus de la zone main, avec
   un `data_directory` dédié pour persister les cookies de session.
4. Tant que la session reste affichée, un `ResizeObserver` synchronise les
   bounds de la webview avec son container HTML.
5. Au démontage du composant (switch de pane), `destroy_provider_webview`
   ferme la webview. Les cookies restent persistés sur disque pour la
   prochaine ouverture.

## Voir aussi

- `ADR-022` : décision encapsulation webview (modèle Franz)
- `ADR-025` : Phase A (placeholder web)
- `ADR-026` : Phase B (Tauri 2 + webviews multiples + partitions cookies)
