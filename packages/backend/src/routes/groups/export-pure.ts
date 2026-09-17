/**
 * Fonctions pures de l'export de groupe (ticket 645f29ca) — plafond de
 * collection et nom de fichier téléchargé.
 *
 * Isolées de `export.ts` délibérément : `export.ts` importe `defineRoute`,
 * `requireAuth`, `requireGroupMembership`, dont la chaîne d'import charge
 * `core/logger.ts` (`loadEnv()` appelé au niveau module, pas paresseusement).
 * Un test qui importe ces fonctions pures **statiquement** en tête de
 * fichier — le seul moyen de les tester sans `await import(...)` — ferait
 * donc échouer `loadEnv()` s'il tourne seul (`vitest run
 * export.test.ts`, hors du `beforeAll`/`setTestEnv()` du reste de la
 * suite Postgres, qui ne s'exécute qu'APRÈS les imports statiques). Ce
 * fichier n'importe que `core/errors.ts` (zéro dépendance sur `core/env.ts`)
 * pour rester importable en tête de fichier sans cet effet de bord.
 */
import { AppError } from '../../core/errors.js';

/** Les 5 collections de l'export, chacune plafonnée indépendamment. */
export type ExportCollection = 'members' | 'events' | 'polls' | 'expenses' | 'todoLists';

/** Plafond de lignes par collection — au-delà, 413 `EXPORT_TOO_LARGE`. */
export const EXPORT_MAX_ROWS_PER_COLLECTION = 5000;

/**
 * Fonction pure (pas d'accès DB) : throw si `count` dépasse le plafond.
 * Appelée par `export.ts` avant tout chargement (`count(*)` d'abord, cf.
 * `countExportCollections`) — revue #122 : la version précédente mesurait
 * `rows.length` après un chargement complet, contredisant le commentaire qui
 * prétendait déjà couper court.
 */
export function assertWithinExportCap(collection: ExportCollection, count: number): void {
  if (count > EXPORT_MAX_ROWS_PER_COLLECTION) {
    throw new AppError('EXPORT_TOO_LARGE', {
      collection,
      count,
      max: EXPORT_MAX_ROWS_PER_COLLECTION,
    });
  }
}

/**
 * Slug du nom de groupe pour le nom de fichier — les groupes n'ont pas de
 * colonne `slug` en base (contrairement aux events/polls/dépenses/todos),
 * `name` est tout ce dont on dispose. Diacritiques retirés, tout ce qui
 * n'est pas alphanumérique devient un tiret ; replié sur `groupe` si le nom
 * ne laisse rien d'exploitable (ex. un nom 100% emoji).
 */
function slugifyGroupName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'groupe';
}

/**
 * `nexus-<slug-du-groupe>-<AAAAMMJJ>.json` (cf. ticket 645f29ca, décision 2).
 *
 * Dupliquée côté web (`GroupsSection.tsx`) avec les mêmes règles : `api()`
 * ne donne pas accès aux headers de réponse (`Content-Disposition` posé ici
 * par la route), donc le nom est recalculé côté client plutôt que lu.
 */
export function exportFilename(groupName: string, exportedAt: string): string {
  const datePart = exportedAt.slice(0, 10).replace(/-/g, '');
  return `nexus-${slugifyGroupName(groupName)}-${datePart}.json`;
}
