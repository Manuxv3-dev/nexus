/**
 * Bootstrap env — DOIT être le tout premier import de l'entrypoint.
 *
 * En ESM, tous les imports d'un module sont résolus avant l'exécution du
 * corps. Donc `dotenv.config()` placé dans le corps de index.ts s'exécute
 * APRÈS le chargement de core/env.ts. La parade : isoler le chargement
 * dotenv dans un module qu'on importe en première position. Comme les
 * modules sont exécutés dans l'ordre topologique, ce module exécute
 * `dotenv.config()` avant que les autres imports ne tentent de lire
 * `process.env`.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

// Depuis packages/backend/src/bootstrap-env.ts → ../../.. = racine du monorepo
dotenv.config({ path: join(here, '..', '..', '..', '.env') });
