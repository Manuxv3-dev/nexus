#!/usr/bin/env node
/**
 * Télécharge la font Inter (variable font) utilisée par les images
 * Open Graph (cf. ADR-018) dans `packages/backend/assets/fonts/`.
 *
 * À lancer une fois après `pnpm i` :
 *
 *   pnpm --filter @nexus/backend setup:fonts
 *
 * Source : repo officiel Google Fonts. La variable font Inter contient
 * toutes les variantes wght 100→900 dans un seul TTF (~700 Ko). Satori
 * 0.10+ supporte les variable fonts : on déclarera la même font 2 fois
 * (weight 400 + weight 700) pointant vers le même buffer.
 *
 * Si le download échoue (réseau, GitHub raw rate-limit), bascule manuelle :
 *   1. Télécharger https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf
 *   2. Placer le fichier sous `packages/backend/assets/fonts/Inter.ttf`
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, '..', 'assets', 'fonts');
const TARGET = resolve(FONTS_DIR, 'Inter.ttf');

// Mirroirs essayés dans l'ordre. Le premier qui répond 200 gagne.
const MIRRORS = [
  'https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf',
  'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf',
];

async function tryDownload(url, target) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return { ok: false, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 50_000) {
    return { ok: false, status: res.status, reason: `réponse trop petite (${buf.length} octets)` };
  }
  await writeFile(target, buf);
  return { ok: true, size: buf.length };
}

async function main() {
  await mkdir(FONTS_DIR, { recursive: true });

  if (existsSync(TARGET)) {
    console.log(`✓ Inter.ttf déjà présent (${TARGET})`);
    return;
  }

  for (const url of MIRRORS) {
    console.log(`↓ Tentative : ${url}`);
    try {
      const res = await tryDownload(url, TARGET);
      if (res.ok) {
        console.log(`✓ Inter.ttf écrit (${res.size} octets) dans ${TARGET}`);
        console.log("\nFont OK. L'endpoint /api/v1/public/og/:type/:slug.png est prêt.");
        return;
      }
      console.log(`  → échec (${res.status}${res.reason ? ` : ${res.reason}` : ''})`);
    } catch (err) {
      console.log(`  → exception : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    'Aucun mirror ne répond. Bascule manuelle :\n' +
      `  1. Télécharge ${MIRRORS[0]}\n` +
      `  2. Place le fichier sous ${TARGET}`,
  );
}

main().catch((err) => {
  console.error('✗ Échec du téléchargement de Inter :', err.message ?? err);
  process.exit(1);
});
