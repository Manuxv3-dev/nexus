import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  BACKEND_PORT: z.coerce.number().int().nonnegative().default(3000),
  BACKEND_HOST: z.string().default('127.0.0.1'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  WS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),

  // Note : ENCRYPTION_KEY_BRIDGES et PROVIDER_SESSIONS_KEY ont été retirés
  // depuis ADR-027 (universalisation webview messaging) + migration 0011.
  // Plus aucun credential côté serveur — toute l'auth se fait dans la
  // webview Tauri. Si tu vois encore ces vars dans un .env quelconque,
  // tu peux les retirer.

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_DEFAULT_MODEL: z.string().default('claude-haiku-4-5'),

  /**
   * URL publique du frontend SPA (@nexus/web). Utilisee dans les liens
   * de partage des killer features (events, polls, expenses, todos) et
   * pour le redirect post-login depuis la landing. Dev: Vite = 5173 ;
   * prod : https://app.nexusapp.chat (cf. ADR-012).
   */
  WEB_BASE_URL: z.string().url().default('http://127.0.0.1:5173'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment variables:\n${issues}`);
    throw new Error('Invalid environment variables');
  }

  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
