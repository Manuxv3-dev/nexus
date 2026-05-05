import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import postgres, { type Sql } from 'postgres';

/**
 * Helpers de tests pour Postgres.
 *
 * Stratégie :
 *  - Tente de se connecter à `DATABASE_URL`
 *  - Crée un schema temporaire (ex: `test_<random>`) pour isoler le run
 *  - Applique les migrations Drizzle générées (drizzle/migrations/*.sql)
 *  - Drop le schema en teardown
 *
 * Si la connexion échoue (Postgres absent en sandbox), retourne `null` et
 * les tests qui en dépendent doivent skipIf.
 */
export interface TestDb {
  url: string; // url avec search_path forcé sur le schema temporaire
  schema: string;
  sql: Sql;
  cleanup: () => Promise<void>;
}

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'migrations');

export async function isPostgresAvailable(url: string): Promise<boolean> {
  try {
    const probe = postgres(url, { max: 1, connect_timeout: 2 });
    await probe`select 1`;
    await probe.end({ timeout: 2 });
    return true;
  } catch {
    return false;
  }
}

export async function setupTestDb(baseUrl: string): Promise<TestDb> {
  const schema = `test_${Math.random().toString(36).slice(2, 10)}`;
  const admin = postgres(baseUrl, { max: 1, connect_timeout: 5 });

  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  await admin.end({ timeout: 5 });

  // URL avec search_path → toutes les requêtes ciblent ce schema
  const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}options=-c%20search_path=${schema}`;
  const sql = postgres(url, { max: 5, connect_timeout: 5 });

  // Apply migrations
  const fs = await import('node:fs/promises');
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  // Drizzle-kit émet les CREATE TYPE / ALTER TYPE qualifiés `"public"."..."`,
  // ce qui contourne notre search_path isolé et provoque des collisions entre
  // tests parallèles (3 fichiers de tests d'intégration → 3 setupTestDb()
  // simultanés tentant le même CREATE TYPE "public"."group_role" → race).
  // On réécrit donc `"public"."` → `"${schema}"."` pour scoper TOUT au
  // schema temporaire. Les autres références (tables, colonnes) restent
  // résolues via search_path comme prévu.
  const rewritePublicSchema = (stmt: string): string => stmt.replace(/"public"\./g, `"${schema}".`);

  for (const file of files) {
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await sql.unsafe(rewritePublicSchema(stmt));
    }
  }

  return {
    url,
    schema,
    sql,
    cleanup: async () => {
      await sql.end({ timeout: 5 });
      const drop = postgres(baseUrl, { max: 1, connect_timeout: 5 });
      await drop.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await drop.end({ timeout: 5 });
    },
  };
}
