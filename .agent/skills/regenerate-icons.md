# Skill — regenerate-icons

Procédure pour regénérer toutes les icônes (Tauri Windows/macOS/Linux,
favicons web, PWA assets, landing) à partir des SVG masters dans
`assets/branding/`.

## Quand l'utiliser

- Après une modification de `assets/branding/logo-mark.svg`,
  `logo-mark-small.svg`, `logo-wordmark.svg` ou `logo-lockup.svg`.
- Après ajout d'une nouvelle taille d'icône à supporter (ex. Microsoft
  Store assets MSIX).
- Si une icône est rapportée comme moche / pixellisée par un user → vérifier
  d'abord que le master a la bonne géométrie pour la taille en question
  (cf. règles d'usage dans `assets/branding/README.md`), puis regénérer.

## Pré-requis

### macOS / Linux / WSL

```bash
# ImageMagick avec support SVG (librsvg2)
sudo apt install -y imagemagick librsvg2-bin   # Ubuntu/Debian
brew install imagemagick                        # macOS

# Optionnel : .icns macOS
# Sur mac : `iconutil` est inclus avec Xcode CLT.
# Sur Linux : `apt install icnsutils` puis le script utilise `png2icns`.
```

### Windows

```powershell
# ImageMagick : Chocolatey OU téléchargement direct
choco install imagemagick

# Vérifier que `magick` est dans le PATH
magick --version
```

## Procédure

### 1. Modifier le master (si besoin)

Éditer `assets/branding/logo-mark.svg` (full ≥32px) ou
`assets/branding/logo-mark-small.svg` (small ≤32px) avec Inkscape, Figma,
ou directement à la main (le fichier est documenté inline). Garder la
charte couleurs du README (3 nuances de violet).

### 2. Lancer le script

```bash
# macOS / Linux / WSL
./scripts/icons-generate.sh
```

```powershell
# Windows pur (PowerShell)
.\scripts\icons-generate.ps1
```

Le script :

1. **Rendu PNG par taille** : pour chaque taille (16, 24, 32, 48, 64,
   128, 192, 256, 512, 1024), rasterize le SVG approprié avec
   `magick -density 300`. Stratégie pixel-perfect : ≤32px depuis
   `mark-small.svg` (sans lignes), ≥48px depuis `mark.svg` (avec lignes).
2. **Tauri icons** : copie vers `packages/desktop/src-tauri/icons/`
   (32×32.png, 64×64.png, 128×128.png, 128×128@2x.png, 256×256.png,
   512×512.png, icon.png 1024). Génère `icon.ico` Windows avec 7
   résolutions imbriquées (16, 24, 32, 48, 64, 128, 256). Génère
   `icon.icns` macOS si `iconutil` ou `png2icns` est dispo.
3. **Web favicons** : `packages/web/public/favicon.svg`, `favicon.ico`,
   `apple-touch-icon.png` (180×180 fond violet sombre `#0a0118` car iOS
   squircle-mask), `icon-192.png`, `icon-512.png`,
   `icon-maskable-512.png` (PWA maskable avec safe area 80px).
4. **Landing** : `packages/landing/public/favicon.svg`.

### 3. Rebuild Tauri (pour vérifier visuellement)

```bash
pnpm tauri:build
# Le binaire sortie est dans packages/desktop/src-tauri/target/release/bundle/
# Lancer le .msi (Windows) ou .exe ou .app (macOS) → vérifier l'icône taskbar/dock.
```

Pour le dev rapide :

```bash
pnpm tauri:dev
# Tauri pickup les nouvelles icônes au prochain restart de la window.
```

### 4. Commit

Conventional commit type `chore(branding)` :

```bash
git add assets/branding/ \
        packages/desktop/src-tauri/icons/ \
        packages/web/public/favicon.{svg,ico} \
        packages/web/public/apple-touch-icon.png \
        packages/web/public/icon-{192,512,maskable-512}.png \
        packages/web/public/manifest.json \
        packages/landing/public/favicon.svg

git commit -m "chore(branding): regenerate icons from masters"
```

## Vérification visuelle

Checklist avant de fermer le sujet :

- [ ] **Taskbar Windows** (16/20/24 selon DPI) : 3 cercles violets
      distinguables, pas de blob flou
- [ ] **Alt-Tab Windows** (32/48) : géométrie 3-fold reconnaissable
- [ ] **Start menu Windows** : net
- [ ] **Onglet Firefox/Chrome/Safari** (16/32) : favicon.svg vectoriel
      (toujours net)
- [ ] **Bookmark Chrome** (16) : utilise le 16 du favicon.ico fallback
- [ ] **Dock macOS** (128 @2x = 256) : full mark avec lignes visibles
- [ ] **iOS home screen** (180×180 squircle-masked) : logo centré bien
      cadré, pas trop collé aux bords
- [ ] **Android home screen** (adaptive, 432×432 foreground) — TODO V2
- [ ] **PWA installée** (manifest 192/512) : icône dans la barre de
      titre PWA et le launcher OS

## Pièges connus

### `convert` lit mal mon SVG

→ Vérifier qu'ImageMagick a le delegate `svg` (`convert -list delegate | grep svg`).
   Si absent, installer `librsvg2-bin` : `apt install librsvg2-bin` puis
   reconfigurer ImageMagick (rare en pratique sur les distros standard).

### Le wordmark "nexus" sort en font générique au lieu d'Inter

→ Le wordmark utilise `<text>` qui dépend des fonts système installées au
   moment du rasterize. Sur le runner Linux du sandbox, Inter n'est pas
   installé → fallback sur sans-serif système. Pour avoir un rendu fidèle
   PNG/ICO, il faut **convertir le `<text>` en `<path>` vectoriel** une
   fois pour toutes (Inkscape : `Object → Object to Path`). À faire
   quand le wordmark est figé visuellement (cf. `assets/branding/README.md`).

### Le `.icns` n'est pas généré

→ Le script log un warning si `iconutil` (mac) ou `png2icns` (linux)
   ne sont pas dispo. Le binaire macOS sera buildable mais l'icône Dock
   sera moche (Tauri tombera sur le PNG par défaut). Pour fix sur Linux :
   `apt install icnsutils`. Pour le runner GitHub Actions macOS, le
   `iconutil` est déjà inclus.

### Tauri ne pickup pas la nouvelle icône en dev

→ Tauri cache les ressources au start. Killer le process Tauri (Cmd/Alt+Q)
   et relancer `pnpm tauri:dev`. Sur Windows, parfois il faut aussi vider
   le cache d'icônes Windows (`ie4uinit.exe -show`).

## Ajouter une nouvelle déclinaison (ex. Microsoft Store)

Au moment où on attaque le packaging Microsoft Store (V1.2+), il faudra
ajouter dans le script `icons-generate.sh` :

```bash
# Microsoft Store assets MSIX
mkdir -p $DEST_TAURI/store
convert -background none -density 300 "$SRC/logo-mark.svg" -resize 44x44   "$DEST_TAURI/store/Square44x44Logo.png"
convert -background none -density 300 "$SRC/logo-mark.svg" -resize 150x150 "$DEST_TAURI/store/Square150x150Logo.png"
convert -background none -density 300 "$SRC/logo-mark.svg" -resize 50x50   "$DEST_TAURI/store/StoreLogo.png"
convert -background none -density 300 "$SRC/logo-lockup.svg" -resize 310x150 "$DEST_TAURI/store/Wide310x150Logo.png"
```

Adapter idem pour `icons-generate.ps1`.
