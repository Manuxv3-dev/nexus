/**
 * Erreurs typées de Nexus.
 *
 * Chaque erreur a un code court (chaîne stable, fait partie de l'API publique)
 * et un mapping vers un status HTTP + message par défaut.
 *
 * Les codes sont utilisés côté client pour discriminer la nature de l'erreur
 * et adapter l'UI (toast, redirection, etc.) sans parser le message.
 *
 * Convention : ajouter ici tout nouveau code, jamais de string magique
 * dans le code applicatif.
 */
export const ERROR_CODES = {
  // Auth
  AUTH_INVALID_CREDENTIALS: { http: 401, message: 'Invalid credentials' },
  AUTH_TOKEN_EXPIRED: { http: 401, message: 'Token expired' },
  AUTH_TOKEN_INVALID: { http: 401, message: 'Token invalid' },
  AUTH_REFRESH_REVOKED: { http: 401, message: 'Refresh token revoked' },
  AUTH_REFRESH_REUSED: { http: 401, message: 'Refresh token reused — all sessions revoked' },
  AUTH_EMAIL_TAKEN: { http: 409, message: 'Email already registered' },
  AUTH_NOT_AUTHENTICATED: { http: 401, message: 'Authentication required' },

  // Authorization
  PERMISSION_DENIED: { http: 403, message: 'Permission denied' },
  GROUP_MEMBERSHIP_REQUIRED: { http: 403, message: 'Group membership required' },

  // Validation
  VALIDATION_ERROR: { http: 400, message: 'Validation error' },

  // Resources
  RESOURCE_NOT_FOUND: { http: 404, message: 'Resource not found' },
  RESOURCE_CONFLICT: { http: 409, message: 'Resource conflict' },

  // Generic
  RATE_LIMITED: { http: 429, message: 'Rate limit exceeded' },
  INTERNAL_ERROR: { http: 500, message: 'Internal server error' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Erreur applicative Nexus. À throw partout au lieu de `new Error`.
 *
 * Le `error-handler` Fastify les transforme en réponse JSON typée.
 *
 * Exemple :
 *   throw new AppError('AUTH_INVALID_CREDENTIALS');
 *   throw new AppError('VALIDATION_ERROR', { field: 'email', expected: 'email' });
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details: unknown;

  constructor(code: ErrorCode, details?: unknown, options?: { cause?: unknown }) {
    super(ERROR_CODES[code].message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return ERROR_CODES[this.code].http;
  }

  toJSON(): { code: ErrorCode; message: string; details: unknown } {
    return {
      code: this.code,
      message: this.message,
      details: this.details ?? null,
    };
  }
}
