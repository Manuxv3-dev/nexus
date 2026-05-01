/**
 * Rendu d'images Open Graph dynamiques (cf. ADR-018).
 *
 * Pipeline :
 *   1. Construire un arbre Satori (objet JSX-like) via `templates.ts`
 *   2. Satori → SVG
 *   3. @resvg/resvg-js → PNG (1200×630, format Open Graph standard)
 *   4. Cache Redis clé `og:<type>:<slug>:<updatedAt>` TTL 30 jours
 *
 * Les fonts Inter (Regular + Bold) sont chargées au boot depuis
 * `packages/backend/assets/fonts/`. Si elles sont absentes, l'endpoint og
 * répond 503 avec un message clair (cf. README backend).
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

import { getRedis } from '../../core/redis.js';
import { logger } from '../../core/logger.js';

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
  /**
   * Buffer de la variable font Inter (contient toutes les variantes wght
   * 100→900 dans un seul fichier TTF). On le référence depuis 2 entries
   * Satori (weight 400 + weight 700) pour que Satori sélectionne les bons
   * glyphs dans la VF.
   */
  variable: ArrayBuffer;
}

let _fontsPromise: Promise<LoadedFonts> | null = null;

async function loadFonts(): Promise<LoadedFonts> {
  if (_fontsPromise) return _fontsPromise;
  _fontsPromise = (async () => {
    const path = resolve(ASSETS_DIR, 'fonts', 'Inter.ttf');
    const buf = await readFile(path);
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
    return { variable: ab };
  })();
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
      { err, expected: resolve(ASSETS_DIR, 'fonts', 'Inter.ttf') },
      '[og] Inter.ttf introuvable — endpoint og désactivé. Lance `pnpm --filter @nexus/backend setup:fonts`',
    );
    _fontsPromise = null; // permet de re-tenter plus tard
    return false;
  }
}

// ───────────────────────────── Render core ──────────────────────────────

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/**
 * Rend un template Satori en PNG. Pas de cache — appelé via `renderOgPng`
 * qui gère le cache Redis.
 */
async function renderTemplateToPng(template: OgTemplate): Promise<Buffer> {
  const fonts = await loadFonts();
  // Variable font : on déclare deux entries pointant vers le même buffer.
  // Satori sélectionne le bon glyph dans la VF en fonction du weight demandé.
  //
  // Le cast `as never` (puis Parameters[0]) est nécessaire parce que la
  // signature de satori type le 1er argument comme `ReactNode` du package
  // `react`. On utilise volontairement notre propre type `OgNode` pour ne
  // pas avoir à ajouter React au backend ; structurellement les deux sont
  // compatibles (Satori parse les objets JSX-like { type, props }).
  const svg = await satori(
    template as unknown as Parameters<typeof satori>[0],
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      fonts: [
        { name: 'Inter', data: fonts.variable, weight: 400, style: 'normal' },
        { name: 'Inter', data: fonts.variable, weight: 700, style: 'normal' },
      ],
    },
  );
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } });
  return resvg.render().asPng();
}

// ───────────────────────────── Cache Redis ──────────────────────────────

/**
 * Clé de cache versionnée par `updatedAt`. Quand la ressource est mutée
 * (event update, vote sur poll, etc.), `updatedAt` change → la clé change
 * → ancien cache orphelin (purgé naturellement au TTL).
 */
function cacheKey(type: string, slug: string, updatedAt: string): string {
  return `og:${type}:${slug}:${updatedAt}`;
}

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 jours

export interface RenderRequest {
  type: 'event' | 'poll' | 'expense' | 'todo' | 'list';
  slug: string;
  /**
   * Timestamp ISO d'une mutation de la ressource (ou createdAt à défaut).
   * Utilisé pour invalider le cache.
   */
  updatedAt: string;
  /**
   * Le template Satori prêt à rendre — construit en amont par la route à
   * partir de la ressource fetchée.
   */
  template: OgTemplate;
}

/**
 * Pipeline complet : tente le cache Redis, sinon rend et met en cache.
 */
export async function renderOgPng(req: RenderRequest): Promise<Buffer> {
  const redis = getRedis();
  const key = cacheKey(req.type, req.slug, req.updatedAt);

  const cached = await redis.getBuffer(key).catch(() => null);
  if (cached && cached.length > 0) {
    return cached;
  }

  const png = await renderTemplateToPng(req.template);
  // EX 30j — auto-purge à expiration. NX éviter les overwrites concurrents
  // (deux requêtes qui rendent en même temps : la première écrit, les
  // suivantes lisent dans le cache à leur prochain hit).
  await redis.set(key, png, 'EX', TTL_SECONDS).catch((err: unknown) => {
    logger.warn({ err, key }, '[og] échec écriture cache, on renvoie quand même');
  });
  return png;
}
