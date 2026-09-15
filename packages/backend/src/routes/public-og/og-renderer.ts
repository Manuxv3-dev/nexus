/**
 * Rendu d'images Open Graph dynamiques (cf. ADR-018).
 *
 * Pipeline :
 *   1. Construire un arbre Satori (objet JSX-like) via `templates.ts`
 *   2. Satori → SVG
 *   3. @resvg/resvg-js → PNG (1200×630, format Open Graph standard)
 *   4. Cache Redis clé `og:<type>:<slug>:<empreinte du template>` TTL 30 jours
 *
 * Les fonts Inter (Regular + Bold, statiques) sont committées dans
 * `packages/backend/assets/fonts/` et chargées au boot. Si elles sont
 * absentes, l'endpoint og répond 503 avec un message clair.
 *
 * MAN-36 : on utilisait auparavant la variable font Inter (une entry
 * `fonts[]` par weight, même buffer). `@shuding/opentype.js` 1.4.0-beta.0
 * (dépendance figée de Satori jusqu'à 0.29.0 au moins) plante en parsant sa
 * table `fvar` — cf. `og-renderer.test.ts`. Deux fichiers statiques évitent
 * la table `fvar` entièrement.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

import { logger } from '../../core/logger.js';
import { getRedis } from '../../core/redis.js';

import type { OgTemplate } from './templates.js';

// ───────────────────────────── Fonts ────────────────────────────────────

/**
 * Chemin vers `packages/backend/assets/fonts/`. On résout depuis le module
 * courant pour fonctionner identiquement en dev (tsx) et en prod (node).
 */
const ASSETS_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  // En dev : packages/backend/src/routes/public-og/og-renderer.ts → ../../../assets
  // En prod : packages/backend/dist/routes/public-og/og-renderer.js → ../../../assets
  return resolve(here, '..', '..', '..', 'assets');
})();

interface LoadedFonts {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let _fontsPromise: Promise<LoadedFonts> | null = null;

async function loadFonts(): Promise<LoadedFonts> {
  if (_fontsPromise) return _fontsPromise;
  _fontsPromise = (async () => {
    const [regular, bold] = await Promise.all([
      readFile(resolve(ASSETS_DIR, 'fonts', 'Inter-Regular.ttf')),
      readFile(resolve(ASSETS_DIR, 'fonts', 'Inter-Bold.ttf')),
    ]);
    return { regular: toArrayBuffer(regular), bold: toArrayBuffer(bold) };
  })().catch((err: unknown) => {
    // Sans ce reset, un échec de lecture (fichier manquant, permissions...)
    // figerait `_fontsPromise` sur une promesse rejetée pour la durée de vie
    // du process — `renderTemplateToPng` (exporté, appelable directement)
    // resterait cassé même après réparation des fichiers.
    _fontsPromise = null;
    throw err;
  });
  return _fontsPromise;
}

/**
 * Renvoie true si les fonts Inter sont disponibles, false sinon. Utilisé
 * par la route au démarrage pour décider si on active l'endpoint og.
 */
export async function fontsAvailable(): Promise<boolean> {
  try {
    await loadFonts();
    return true;
  } catch (err) {
    logger.warn(
      { err, expected: resolve(ASSETS_DIR, 'fonts') },
      '[og] Inter-Regular.ttf / Inter-Bold.ttf introuvables dans assets/fonts/ — endpoint og désactivé',
    );
    return false; // loadFonts() a déjà reset _fontsPromise, une prochaine tentative relira le disque
  }
}

// ───────────────────────────── Render core ──────────────────────────────

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/**
 * Rend un template Satori en PNG. Pas de cache — appelé via `renderOgPng`
 * qui gère le cache Redis. Exporté pour être testé directement sans
 * dépendre de Redis (cf. `og-renderer.test.ts`).
 */
export async function renderTemplateToPng(template: OgTemplate): Promise<Buffer> {
  const fonts = await loadFonts();
  // Le cast `as never` (puis Parameters[0]) est nécessaire parce que la
  // signature de satori type le 1er argument comme `ReactNode` du package
  // `react`. On utilise volontairement notre propre type `OgNode` pour ne
  // pas avoir à ajouter React au backend ; structurellement les deux sont
  // compatibles (Satori parse les objets JSX-like { type, props }).
  const svg = await satori(template as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: fonts.bold, weight: 700, style: 'normal' },
    ],
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } });
  return resvg.render().asPng();
}

// ───────────────────────────── Cache Redis ──────────────────────────────

/**
 * Clé de cache dérivée du CONTENU rendu (cf. 163de7bb).
 *
 * Elle versionnait sur `updatedAt` de la ressource. Tout ce qui changeait le
 * rendu sans toucher la ligne laissait le PNG périmé 30 jours — le départ
 * d'un membre retire son RSVP du décompte (filtre à la lecture, 2f422033)
 * sans toucher `events.updated_at`, et une image déjà rendue affichait
 * « 5 oui » dont un absent. Élargir ce qui bump `updated_at` (ce que
 * `upsertRsvp` et `vote` faisaient déjà pour ce seul cache) restait faux pour
 * tout ce qu'on oublierait.
 *
 * Le template Satori contient tout ce qui est dessiné — titre, décomptes,
 * options, montants. Son empreinte fait la clé : si le rendu change, la clé
 * change, quelle qu'en soit la raison ; s'il ne change pas, le cache sert.
 * `JSON.stringify` est déterministe ici, les templates sont construits par
 * le code dans un ordre fixe. 16 hex de SHA-1 suffisent : ce n'est pas de la
 * sécurité, c'est de l'adressage. Les clés orphelines expirent au TTL.
 */
export function ogCacheKey(type: string, slug: string, template: OgTemplate): string {
  const digest = createHash('sha1').update(JSON.stringify(template)).digest('hex').slice(0, 16);
  return `og:${type}:${slug}:${digest}`;
}

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 jours

export interface RenderRequest {
  type: 'event' | 'poll' | 'expense' | 'todo' | 'list';
  slug: string;
  /**
   * Le template Satori prêt à rendre — construit en amont par la route à
   * partir de la ressource fetchée. C'est aussi lui qui fait la clé de cache
   * (cf. `ogCacheKey`) : rien d'autre n'a à être versionné.
   */
  template: OgTemplate;
}

/**
 * Pipeline complet : tente le cache Redis, sinon rend et met en cache.
 */
export async function renderOgPng(req: RenderRequest): Promise<Buffer> {
  const redis = getRedis();
  const key = ogCacheKey(req.type, req.slug, req.template);

  const cached = await redis.getBuffer(key).catch(() => null);
  if (cached && cached.length > 0) {
    return cached;
  }

  const png = await renderTemplateToPng(req.template);
  // EX 30 j — auto-purge à expiration. Pas de NX : deux requêtes qui rendent
  // en même temps écrivent le même PNG sous la même clé (le contenu fait la
  // clé), l'écrasement est sans effet.
  await redis.set(key, png, 'EX', TTL_SECONDS).catch((err: unknown) => {
    logger.warn({ err, key }, '[og] échec écriture cache, on renvoie quand même');
  });
  return png;
}
