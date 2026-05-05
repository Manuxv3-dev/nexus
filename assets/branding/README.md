# Branding & icons — masters

Sources vectorielles maîtres du logo Nexus. Toutes les déclinaisons
(favicons, app icons, PNG, ICO, ICNS, store assets) sont générées
automatiquement à partir de ces 4 SVG via `scripts/icons-generate.sh`
(macOS/Linux/WSL) ou `scripts/icons-generate.ps1` (Windows pur).

## Fichiers maîtres

| Fichier | Usage | viewBox |
|---|---|---|
| `logo-mark.svg` | Symbole **full** : 3 cercles violets reliés par lignes triangulaires. Pour favicon onglet, splash screens, hero landing, store hero (>= 64px). | 80 × 80 |
| `logo-mark-small.svg` | Symbole **small-mark** : 3 cercles plus gros qui se touchent, **sans lignes** (qui disparaissent en small). Pour app icon ≤ 32px (taskbar Windows, alt-tab, favicon 16/32, Spotlight macOS, Microsoft Store Square44). | 32 × 32 |
| `logo-wordmark.svg` | Logotype **nexus** en minuscules (font system Inter / SF Pro). Pour landing header, login screen, signature email, store listing. | 200 × 60 |
| `logo-lockup.svg` | **Mark full + wordmark** côte à côte. Pour le hero principal de la landing et les contextes où on veut le branding complet en un bloc. | 280 × 80 |

## Charte couleurs

| Token | Hex | Usage |
|---|---|---|
| `--nexus-purple-500` | `#7c5cfc` | Cercle principal (gauche) |
| `--nexus-purple-400` | `#a78bfa` | Cercle secondaire (droite) |
| `--nexus-purple-300` | `#c084fc` | Cercle tertiaire (bas) |

Le logo fonctionne sur fond clair ET sombre sans variante (3 violets
saturés bien visibles sur les deux). Si plus tard on veut une variante
monochrome (SVG outline blanc pour fonds très sombres ou impressions
mono), on l'ajoutera ici.

## Police du wordmark

`-apple-system, BlinkMacSystemFont, "Inter", "SF Pro Display", sans-serif`,
font-weight 600 (semi-bold), letter-spacing -0.02em, all-lowercase.

⚠️ Pour rasterizer correctement le wordmark en PNG/ICO sans dépendre des
fonts système installées au moment du build, il faut **convertir le
`<text>` en `<path>` une fois pour toutes** (Inkscape : `Object → Object
to Path`, ou outil online type [SVGOMG](https://jakearchibald.github.io/svgomg/)
+ stroke-to-path). À faire au moment où le wordmark est figé visuellement.

Pour l'instant le wordmark utilise `<text>` (suffisant pour le rendu web,
qui charge la font system).

## Règles d'usage

1. **Mark full vs small** : à partir de **32 px**, on utilise `logo-mark.svg`
   (full avec lignes). En dessous, **toujours** `logo-mark-small.svg`.
2. **Lockup** : seulement sur fond ≥ 280 px de large (sinon les éléments
   s'écrasent). Pour les espaces étroits, mark seul + wordmark séparé.
3. **Espace de protection** : autour du mark, garder au minimum la largeur
   d'un cercle (≈ 16/80 = 20% du viewBox) sans autre élément graphique.
4. **Modifications** : ne jamais éditer une déclinaison générée
   (ex. `packages/desktop/src-tauri/icons/icon.ico`). Toujours partir d'ici
   et regénérer via le script.

## Procédure de regénération

Après modification d'un master, lancer le script :

```bash
# macOS / Linux / WSL — pré-requis : rsvg-convert + ImageMagick + iconutil (mac)
./scripts/icons-generate.sh
```

```powershell
# Windows pur — pré-requis : ImageMagick + Inkscape installés
.\scripts\icons-generate.ps1
```

Le script produit (cf. `.agent/skills/regenerate-icons.md` pour le détail) :

- `packages/desktop/src-tauri/icons/icon.ico` (16, 24, 32, 48, 64, 128, 256 — pixel-perfect)
- `packages/desktop/src-tauri/icons/icon.icns` (macOS)
- `packages/desktop/src-tauri/icons/*.png` (toutes tailles Tauri)
- `packages/web/public/favicon.svg` (copie du master)
- `packages/web/public/favicon.ico` (fallback IE/legacy)
- `packages/web/public/apple-touch-icon.png` (180×180)
- `packages/web/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (PWA)
- `packages/web/public/manifest.json` (PWA avec icons[])

## Liens

- ADR-021 (Design System v2 true Apple HIG) — palette + typo de référence
- `.agent/notes/branding-icons.md` — historique du sujet + audit
- `.agent/skills/regenerate-icons.md` — procédure détaillée
