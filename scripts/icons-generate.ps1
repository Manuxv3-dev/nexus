# Regenerate all icon assets from the master SVGs in `assets/branding/`.
#
# Usage : .\scripts\icons-generate.ps1
#
# Pré-requis :
#   - ImageMagick installé (`magick` dans le PATH)
#       choco install imagemagick      # via Chocolatey
#       OU télécharger : https://imagemagick.org/script/download.php#windows
#       (cocher "Install legacy utilities (e.g. convert)" pendant l'installation)
#   - Pour le .icns macOS : ce script ne le génère PAS (Windows pur).
#       Le rebuild macOS doit être fait depuis un mac. Tauri CLI sait
#       construire .icns sur macOS via `pnpm tauri:build`.
#
# cf. .agent/skills/regenerate-icons.md pour la procédure détaillée.

$ErrorActionPreference = 'Stop'

$ROOT = (Resolve-Path "$PSScriptRoot\..").Path
$SRC = Join-Path $ROOT 'assets\branding'
$TMP = Join-Path $env:TEMP "nexus-icons-$([guid]::NewGuid())"
$null = New-Item -ItemType Directory -Path $TMP

$DEST_TAURI = Join-Path $ROOT 'packages\desktop\src-tauri\icons'
$DEST_WEB = Join-Path $ROOT 'packages\web\public'
$DEST_LANDING = Join-Path $ROOT 'packages\landing\public'

# Vérifs
if (-not (Get-Command magick -ErrorAction SilentlyContinue)) {
  Write-Error "❌ ImageMagick (magick) introuvable. Installer via 'choco install imagemagick' ou https://imagemagick.org/"
}
if (-not (Test-Path $SRC)) { Write-Error "❌ assets/branding/ introuvable" }
if (-not (Test-Path "$SRC\logo-mark.svg")) { Write-Error "❌ logo-mark.svg manquant" }
if (-not (Test-Path "$SRC\logo-mark-small.svg")) { Write-Error "❌ logo-mark-small.svg manquant" }

Write-Host "🎨 Génération des assets icons depuis $SRC"
Write-Host "   → temp dir: $TMP"

try {
  # ─── Étape 1 : rendu PNG par taille (pixel-perfect, depuis le bon SVG) ─────
  Write-Host "  [1/5] Rendu PNG multi-tailles..."
  foreach ($size in 16, 24, 32) {
    & magick -background none -density 300 "$SRC\logo-mark-small.svg" -resize "${size}x${size}" "$TMP\icon-$size.png"
  }
  foreach ($size in 48, 64, 128, 192, 256, 512, 1024) {
    & magick -background none -density 300 "$SRC\logo-mark.svg" -resize "${size}x${size}" "$TMP\icon-$size.png"
  }

  # ─── Étape 2 : Tauri icons ─────────────────────────────────────────────────
  Write-Host "  [2/5] Tauri icons..."
  $null = New-Item -ItemType Directory -Force -Path $DEST_TAURI
  Copy-Item "$TMP\icon-32.png"  "$DEST_TAURI\32x32.png" -Force
  Copy-Item "$TMP\icon-64.png"  "$DEST_TAURI\64x64.png" -Force
  Copy-Item "$TMP\icon-128.png" "$DEST_TAURI\128x128.png" -Force
  Copy-Item "$TMP\icon-256.png" "$DEST_TAURI\128x128@2x.png" -Force
  Copy-Item "$TMP\icon-256.png" "$DEST_TAURI\256x256.png" -Force
  Copy-Item "$TMP\icon-512.png" "$DEST_TAURI\512x512.png" -Force
  Copy-Item "$TMP\icon-1024.png" "$DEST_TAURI\icon.png" -Force
  Copy-Item "$TMP\icon-1024.png" "$DEST_TAURI\icon.icns_source.png" -Force

  # icon.ico Windows : 7 résolutions pixel-perfect
  & magick "$TMP\icon-16.png" "$TMP\icon-24.png" "$TMP\icon-32.png" `
           "$TMP\icon-48.png" "$TMP\icon-64.png" "$TMP\icon-128.png" "$TMP\icon-256.png" `
           "$DEST_TAURI\icon.ico"

  Write-Host "  ⚠️  icon.icns macOS non généré sur Windows (build macOS doit se faire sur mac)"

  # ─── Étape 3 : Web favicons ───────────────────────────────────────────────
  Write-Host "  [3/5] Web favicons..."
  $null = New-Item -ItemType Directory -Force -Path $DEST_WEB
  Copy-Item "$SRC\logo-mark.svg" "$DEST_WEB\favicon.svg" -Force
  & magick "$TMP\icon-16.png" "$TMP\icon-32.png" "$TMP\icon-48.png" "$DEST_WEB\favicon.ico"
  Copy-Item "$TMP\icon-192.png" "$DEST_WEB\icon-192.png" -Force
  Copy-Item "$TMP\icon-512.png" "$DEST_WEB\icon-512.png" -Force

  # Apple touch icon
  & magick -size 180x180 canvas:"#0a0118" "$TMP\apple-bg.png"
  & magick -background none -density 300 "$SRC\logo-mark.svg" -resize 140x140 "$TMP\apple-fg.png"
  & magick "$TMP\apple-bg.png" "$TMP\apple-fg.png" -gravity center -composite "$DEST_WEB\apple-touch-icon.png"

  # Maskable PWA
  & magick -size 512x512 canvas:"#0a0118" "$TMP\maskable-bg.png"
  & magick -background none -density 300 "$SRC\logo-mark.svg" -resize 352x352 "$TMP\maskable-fg.png"
  & magick "$TMP\maskable-bg.png" "$TMP\maskable-fg.png" -gravity center -composite "$DEST_WEB\icon-maskable-512.png"

  # ─── Étape 4 : Landing favicon ────────────────────────────────────────────
  Write-Host "  [4/5] Landing favicon..."
  $null = New-Item -ItemType Directory -Force -Path $DEST_LANDING
  Copy-Item "$SRC\logo-mark.svg" "$DEST_LANDING\favicon.svg" -Force

  # ─── Étape 5 : Recap ──────────────────────────────────────────────────────
  Write-Host "  [5/5] Done."
  Write-Host ""
  Write-Host "✅ Assets régénérés."
  Write-Host "👉 Rebuild Tauri pour voir le nouvel icon : pnpm tauri:build"

} finally {
  Remove-Item -Recurse -Force $TMP
}
