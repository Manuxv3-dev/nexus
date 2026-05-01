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

  /**
   * Cle de chiffrement AES-256-GCM pour les credentials des sessions
   * messageries (cf. ADR-009, J3a). Format : base64 d'un buffer 32 bytes.
   * Generation : node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   * A sauver dans un coffre securise (1Password/KeePass).
   */
  ENCRYPTION_KEY_BRIDGES: z
    .string()
    .refine(
      (v) => {
        try {
          return Buffer.from(v, 'base64').length === 32;
        } catch {
          return false;
        }
      },
      { message: 'ENCRYPTION_KEY_BRIDGES must be base64-encoded 32 bytes' },
    )
    .optional(),

  PROVIDER_SESSIONS_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_DEFAULT_MODEL: z.string().default('claude-haiku-4-5'),

  /**
   * URL publique du frontend SPA (@nexus/web). Utilisee par les callbacks
   * OAuth des bridges (Discord, Messenger/WhatsApp) pour rediriger
   * l'utilisateur vers l'app apres autorisation. Dev: Vite = 5173 ;
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
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
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
