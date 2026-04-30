import { z } from 'zod';

/**
 * Schéma de réponse du healthcheck du backend Nexus.
 * Premier exemple de schéma partagé entre backend et clients.
 */
export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  /** ISO 8601 UTC */
  timestamp: z.string().datetime(),
  /** État des dépendances critiques */
  dependencies: z.object({
    postgres: z.enum(['ok', 'degraded', 'down', 'unknown']),
    redis: z.enum(['ok', 'degraded', 'down', 'unknown']),
  }),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
