import { defineConfig } from 'drizzle-kit';

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
