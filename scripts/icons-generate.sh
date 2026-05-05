#!/usr/bin/env bash
# Regenerate all icon assets from the master SVGs in `assets/branding/`.
#
# Usage : ./scripts/icons-generate.sh
#
# Pré-requis :
#   - ImageMagick (`convert`) avec support SVG (librsvg2)
#   - Optionnel : `iconutil` (macOS only) ou `png2icns` (libicns-utils sur Linux)
#     pour le `.icns` macOS. Si absent, on skip et le binaire mac sera moche
#     (fallback sur le PNG).
#
# Stratégie pixel-perfect : pour les tailles ≤ 32px, on rend depuis
# `logo-mark-small.svg` (3 cercles plus gros sans lignes, optimisé small).
# Pour ≥ 48px, on rend depuis `logo-mark.svg` (full avec lignes). Chaque
# taille est rendue indépendamment depuis le SVG (pas par downscaling
# d'un PNG 1024) pour éviter le flou.
#
# cf. .agent/skills/regenerate-icons.md pour la procédure détaillée.

set -euo pipefail

# Répertoires
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/assets/branding"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT

DEST_TAURI="$ROOT/packages/desktop/src-tauri/icons"
DEST_WEB="$ROOT/packages/web/public"
DEST_LANDING="$ROOT/packages/landing/public"

# Vérifs
command -v convert >/dev/null 2>&1 || { echo "❌ ImageMagick (convert) introuvable. Installer via 'apt install imagemagick' / 'brew install imagemagick' / chocolatey." >&2; exit 1; }
[ -d "$SRC" ] || { echo "❌ assets/branding/ introuvable" >&2; exit 1; }
[ -f "$SRC/logo-mark.svg" ] || { echo "❌ logo-mark.svg manquant" >&2; exit 1; }
[ -f "$SRC/logo-mark-small.svg" ] || { echo "❌ logo-mark-small.svg manquant" >&2; exit 1; }

echo "🎨 Génération des assets icons depuis $SRC"
echo "   → temp dir: $TMP"

# ─── Étape 1 : rendu PNG par taille (pixel-perfect, depuis le bon SVG) ─────
echo "  [1/5] Rendu PNG multi-tailles..."
for size in 16 24 32; do
  convert -background none -density 300 "$SRC/logo-mark-small.svg" -resize ${size}x${size} "$TMP/icon-${size}.png"
done
for size in 48 64 128 192 256 512 1024; do
  convert -background none -density 300 "$SRC/logo-mark.svg" -resize ${size}x${size} "$TMP/icon-${size}.png"
done

# ─── Étape 2 : Tauri icons ─────────────────────────────────────────────────
echo "  [2/5] Tauri icons (packages/desktop/src-tauri/icons/)..."
mkdir -p "$DEST_TAURI"
cp "$TMP/icon-32.png"  "$DEST_TAURI/32x32.png"
cp "$TMP/icon-64.png"  "$DEST_TAURI/64x64.png"
cp "$TMP/icon-128.png" "$DEST_TAURI/128x128.png"
cp "$TMP/icon-256.png" "$DEST_TAURI/128x128@2x.png"
cp "$TMP/icon-256.png" "$DEST_TAURI/256x256.png"
cp "$TMP/icon-512.png" "$DEST_TAURI/512x512.png"
cp "$TMP/icon-1024.png" "$DEST_TAURI/icon.png"
cp "$TMP/icon-1024.png" "$DEST_TAURI/icon.icns_source.png"

# Tauri Windows : icon.ico avec 7 résolutions pixel-perfect
convert "$TMP/icon-16.png" "$TMP/icon-24.png" "$TMP/icon-32.png" \
        "$TMP/icon-48.png" "$TMP/icon-64.png" "$TMP/icon-128.png" "$TMP/icon-256.png" \
        "$DEST_TAURI/icon.ico"

# Tauri macOS : icon.icns (besoin de iconutil ou png2icns)
if command -v iconutil >/dev/null 2>&1; then
  ICONSET="$TMP/icon.iconset"
  mkdir -p "$ICONSET"
  cp "$TMP/icon-16.png"   "$ICONSET/icon_16x16.png"
  cp "$TMP/icon-32.png"   "$ICONSET/icon_16x16@2x.png"
  cp "$TMP/icon-32.png"   "$ICONSET/icon_32x32.png"
  cp "$TMP/icon-64.png"   "$ICONSET/icon_32x32@2x.png"
  cp "$TMP/icon-128.png"  "$ICONSET/icon_128x128.png"
  cp "$TMP/icon-256.png"  "$ICONSET/icon_128x128@2x.png"
  cp "$TMP/icon-256.png"  "$ICONSET/icon_256x256.png"
  cp "$TMP/icon-512.png"  "$ICONSET/icon_256x256@2x.png"
  cp "$TMP/icon-512.png"  "$ICONSET/icon_512x512.png"
  cp "$TMP/icon-1024.png" "$ICONSET/icon_512x512@2x.png"
  iconutil -c icns "$ICONSET" -o "$DEST_TAURI/icon.icns"
elif command -v png2icns >/dev/null 2>&1; then
  png2icns "$DEST_TAURI/icon.icns" \
    "$TMP/icon-16.png" "$TMP/icon-32.png" "$TMP/icon-128.png" \
    "$TMP/icon-256.png" "$TMP/icon-512.png" "$TMP/icon-1024.png"
else
  echo "  ⚠️  iconutil/png2icns absents — icon.icns non généré (build macOS pas optimal)"
fi

# ─── Étape 3 : Web favicons ───────────────────────────────────────────────
echo "  [3/5] Web favicons (packages/web/public/)..."
mkdir -p "$DEST_WEB"
cp "$SRC/logo-mark.svg" "$DEST_WEB/favicon.svg"
convert "$TMP/icon-16.png" "$TMP/icon-32.png" "$TMP/icon-48.png" "$DEST_WEB/favicon.ico"
cp "$TMP/icon-192.png" "$DEST_WEB/icon-192.png"
cp "$TMP/icon-512.png" "$DEST_WEB/icon-512.png"

# Apple touch icon : fond violet sombre (le squircle iOS coupe les coins)
convert -size 180x180 canvas:"#0a0118" "$TMP/apple-bg.png"
convert -background none -density 300 "$SRC/logo-mark.svg" -resize 140x140 "$TMP/apple-fg.png"
convert "$TMP/apple-bg.png" "$TMP/apple-fg.png" -gravity center -composite "$DEST_WEB/apple-touch-icon.png"

# Maskable PWA icon : safe area 80px sur 512 (logo dans 352×352 centré)
# https://web.dev/articles/maskable-icon
convert -size 512x512 canvas:"#0a0118" "$TMP/maskable-bg.png"
convert -background none -density 300 "$SRC/logo-mark.svg" -resize 352x352 "$TMP/maskable-fg.png"
convert "$TMP/maskable-bg.png" "$TMP/maskable-fg.png" -gravity center -composite "$DEST_WEB/icon-maskable-512.png"

# ─── Étape 4 : Landing favicon ────────────────────────────────────────────
echo "  [4/5] Landing favicon (packages/landing/public/)..."
mkdir -p "$DEST_LANDING"
cp "$SRC/logo-mark.svg" "$DEST_LANDING/favicon.svg"

# ─── Étape 5 : Recap ──────────────────────────────────────────────────────
echo "  [5/5] Done."
echo ""
echo "✅ Assets régénérés :"
echo "   - Tauri Windows : $DEST_TAURI/icon.ico (7 tailles pixel-perfect)"
echo "   - Tauri macOS   : $DEST_TAURI/icon.icns (si iconutil/png2icns présent)"
echo "   - Tauri Linux   : $DEST_TAURI/*.png (toutes tailles)"
echo "   - Web favicon   : $DEST_WEB/favicon.{svg,ico}"
echo "   - Web PWA       : $DEST_WEB/icon-{192,512,maskable-512}.png + apple-touch-icon.png"
echo "   - Landing       : $DEST_LANDING/favicon.svg"
echo ""
echo "👉 Rebuild Tauri pour voir le nouvel icon : pnpm tauri:build"
