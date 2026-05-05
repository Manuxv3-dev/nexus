# Branding & icons — sujet à traiter proprement

**Statut** : 🟠 ouvert — bloqué sur décision design (étape 1).
**Déclencheur** : 2026-05-05, Manu remonte que l'icône Nexus dans la
taskbar Windows est pixellisée / moche.

## 🔍 Audit de l'existant (2026-05-05)

### Desktop Tauri (`packages/desktop/src-tauri/icons/`)

Généré par `tauri icon` à partir d'un PNG 1024×1024 sourcé par downscaling
du SVG `web/public/favicon.svg`.

| Fichier | Format | Tailles |
|---|---|---|
| `32x32.png` | PNG | 32×32 |
| `64x64.png` | PNG | 64×64 |
| `128x128.png` | PNG | 128×128 |
| `128x128@2x.png` | PNG | 256×256 |
| `256x256.png` | PNG | 256×256 |
| `512x512.png` | PNG | 512×512 |
| `icon.png` | PNG | 1024×1024 |
| `icon.icns_source.png` | PNG | 1024×1024 (source macOS) |
| `icon.ico` | Multi-resource ICO | 16, 32, 48, 64, 128, 256 |

⚠️ Pas de `.icns` macOS bundlé (donc pas de macOS build propre pour le moment).

### Web

| Package | Fichier | Format |
|---|---|---|
| `packages/web/public/` | `favicon.svg` | SVG vectoriel (source du design actuel) |
| `packages/web/dist/` | `favicon.svg` | copie du build |
| `packages/landing/public/` | `favicon.svg` | copie pour la landing |

⚠️ **Manque** : pas de `favicon.ico` fallback, pas de `apple-touch-icon.png`,
pas de `icon-192.png` / `icon-512.png` PWA, pas de `manifest.json` avec
icons, pas de variante mode sombre.

### Design source (`favicon.svg`)

Triple cercle violet relié en triangle :

```svg
<svg viewBox="0 0 80 80" width="32" height="32">
  <circle cx="26" cy="26" r="8" fill="#7c5cfc" />
  <circle cx="54" cy="26" r="8" fill="#a78bfa" />
  <circle cx="40" cy="54" r="8" fill="#c084fc" />
  <line x1="26" y1="26" x2="54" y2="26" stroke="#7c5cfc" stroke-width="2.5" opacity="0.6" />
  <line x1="26" y1="26" x2="40" y2="54" stroke="#a78bfa" stroke-width="2.5" opacity="0.6" />
  <line x1="54" y1="26" x2="40" y2="54" stroke="#c084fc" stroke-width="2.5" opacity="0.6" />
</svg>
```

Concept : 3 nœuds connectés = "nexus" / réseau. Joli en grand.
Problème : à 16×16 (taskbar Windows), les cercles ⌀8 deviennent ⌀1.6 px
chacun → blob anti-aliasé illisible.

### Mobile (futur)

Rien. Pas démarré.

### Stores

Rien. Pas démarré (Microsoft Store, App Store, Play Store).

## 🩺 Diagnostic

**Pourquoi la taskbar est moche** : 3 causes par ordre de probabilité.

1. **Design pas optimisé small-scale** — la stratégie "downscale 1024 → 16"
   sans hinting pixel-perfect transforme les détails fins (cercles minces,
   lignes, espaces blancs) en flou anti-aliasé. C'est le cas typique d'un
   logo "graphique" pas pensé multi-échelles.
2. **Pas de variante "small-mark"** — les bons logos applicatifs ont 2-3
   déclinaisons : full (>64px), reduced (32-48), monogram/symbol (≤24).
   Apple, Slack, Discord etc. font ça.
3. **`icon.ico` peut-être pas optimal** — Tauri CLI génère un .ico standard
   mais ne hint pas spécifiquement les 16/24/32. Il faudrait des PNG
   pixel-perfect distincts par taille avant l'agrégation .ico.

## 📋 Plan d'action — 3 étapes

### Étape 1 — Décider du design

3 options à choisir par Manu :

#### Option A — Garder le triple cercle, ajouter une variante small-mark

- Conserver le SVG actuel comme "logo full"
- Créer un SVG "small-mark" : un seul glyphe massif optimisé pour ≤24px.
  Ex. les 3 cercles fusionnés en pétale unique (forme trèfle 3-fold), ou
  monogramme **N** stylisé violet, ou point central + halo.
- Use case : full pour landing/header/store ; small-mark pour favicon
  16/32, taskbar, alt-tab, iOS app icon (qui sera masqué en squircle).
- **Coût** : ~30 min de design (Inkscape / Figma) + génération automatisée.
- **Pour** : préserve l'identité existante. Économique.
- **Contre** : ça reste un design "amateur" — peut-être à refaire en V2 par un pro.

#### Option B — Refaire from scratch un pictogramme massif optimisé

- Concept : un seul glyphe géométrique dense (ex. losange / pentagone /
  ouvert "<>") qui tient à toutes les tailles sans variante.
- Inspirations : Linear (carré arrondi avec L massif), Notion (N stylisé),
  Discord (manette stylisée), Slack (#).
- **Coût** : ~1-2h en autodidacte avec Phosphor/Heroicons comme base + Inkscape.
- **Pour** : un seul asset, plus simple à maintenir. Identité plus pro.
- **Contre** : on perd le triple cercle. Faut décider d'un nouveau concept visuel.

#### Option C — Externaliser à un designer

- Brief : logotype Nexus + symbole + déclinaisons (favicon, app icon, store).
- Plateformes : 99designs (concours ~300€), Fiverr (designer solo ~50-200€),
  Upwork, ou contact perso.
- Livrable : master AI/SVG + déclinaisons PNG/ICO.
- **Coût** : 50-300€ + 1-2 semaines.
- **Pour** : qualité pro. Identité durable. Asset master propre.
- **Contre** : argent + délai. À faire avant le launch public.

**Recommandation Claude** : **A maintenant** (small-mark à fabriquer dans la
session) pour débloquer la finition Tauri, et **C avant le launch public V1**
(externaliser pour l'identité finale).

### Étape 2 — Générer toutes les déclinaisons

Une fois le design figé en SVG master, produire :

| Cible | Fichiers attendus | Outil |
|---|---|---|
| **Tauri Windows** | `icon.ico` (16, 24, 32, 48, 64, 128, 256 — pixel-perfect chaque taille avant assemblage) | ImageMagick + script bash |
| **Tauri macOS** | `icon.icns` (16, 32, 64, 128, 256, 512, 1024 + @2x) | `iconutil` ou `png2icns` |
| **Tauri Linux** | PNG × tailles | `tauri icon` CLI |
| **Web favicon** | `favicon.ico`, `favicon.svg`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-mask.png` (maskable PWA) | RealFaviconGenerator (online) |
| **Web manifest** | `manifest.json` avec `icons[]` (192, 512, maskable) | écrit à la main |
| **Microsoft Store** (V2 distrib publique) | `Square150x150Logo.png`, `Square44x44Logo.png` (taskbar !), `StoreLogo.png`, `Wide310x150Logo.png` | Visual Studio Asset Generator |
| **Mobile iOS** (futur) | `icon-1024.png` | Expo génère le reste depuis 1024 |
| **Mobile Android** (futur) | `icon-1024.png` + `foreground.png` 432×432 + `background.png` (adaptive) | Expo asset generator |

**Important pour Windows taskbar spécifiquement** : il faut absolument que
l'asset `Square44x44Logo.png` (Microsoft Store packaging MSIX) soit
**pixel-perfect 44×44**, pas un downscale. Idem pour `icon.ico` au moment
du build Tauri MSI.

#### Procédure recommandée pour pixel-perfect ICO

```bash
# 1. Master SVG → PNG pixel-perfect par taille (rsvg-convert respecte les hints)
for size in 16 24 32 48 64 128 256; do
  rsvg-convert -w $size -h $size logo-master.svg -o icon-${size}.png
done

# 2. Assembler le .ico
magick icon-16.png icon-24.png icon-32.png icon-48.png icon-64.png \
       icon-128.png icon-256.png icon.ico

# 3. Pour Windows : copier dans src-tauri/icons/
cp icon.ico packages/desktop/src-tauri/icons/icon.ico

# 4. Rebuild Tauri
pnpm tauri:build
```

Le secret c'est de générer les petites tailles avec leur PROPRE pass de
rendering vectoriel (qui peut hinter au pixel près), pas par downscaling
d'un 1024.

### Étape 3 — Vérification multi-cibles

Checklist visuelle :

- [ ] Taskbar Windows 10/11 (16×16, 20×20, 24×24 selon DPI screen)
- [ ] Alt-Tab Windows (32×32, 48×48)
- [ ] Start menu Windows (44×44 small, 150×150 medium)
- [ ] Notifications Windows (44×44)
- [ ] Dock macOS (128×128 @2x = 256)
- [ ] Spotlight macOS (32×32)
- [ ] Onglet Firefox/Chrome/Safari (16/32 favicon)
- [ ] Bookmark bar (16×16)
- [ ] iOS home screen (180×180 apple-touch-icon, masqué en squircle)
- [ ] iOS Spotlight / settings (29, 40, 60)
- [ ] Android home screen (adaptive 432×432 foreground + masking circulaire/squircle)
- [ ] PWA installée (manifest icons 192 / 512 + maskable)
- [ ] Microsoft Store listing (300×300 hero, 7.5:3 banner, screenshots)

## 📍 Décisions à prendre

1. **Design** : option A / B / C ? (cf. étape 1)
2. **Couleur primaire** : violet `#7c5cfc` (actuel) on garde ? Ou pivot vers
   l'accent Apple `system-blue` qu'on a dans le design system v2 (ADR-021) ?
3. **Mode sombre** : variante claire vs sombre du logo ? Ou un seul logo
   qui marche sur les deux fonds (silhouette neutre) ?
4. **Wordmark "nexus"** : logotype écrit (texte stylisé) en plus du symbole ?
   Pour landing / store. Si oui, choisir font (déjà des options sur la
   landing actuelle).

## 🚧 Liens

- ADR-021 (Design System v2 true Apple HIG) — palette + typo de référence
- Tauri docs icons : https://v2.tauri.app/learn/configure/icons/
- RealFaviconGenerator : https://realfavicongenerator.net/
- Apple HIG — App Icons : https://developer.apple.com/design/human-interface-guidelines/app-icons
- Material You adaptive icons : https://m3.material.io/styles/icons/applying-icons
