import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Charge le .env depuis la racine du monorepo
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_dev',
  },
  strict: true,
  verbose: true,
});
