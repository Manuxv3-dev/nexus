import { z } from 'zod';

/**
 * Schémas Zod pour les endpoints auth Nexus.
 *
 * Ces schémas sont la source de vérité côté backend. Ils descendent côté
 * desktop/mobile via @nexus/shared (à ajouter en J1e ou plus tard).
 */

// ----- Atomes ----------------------------------------------------------------

export const PasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256, 'Password too long');

export const EmailSchema = z.string().email().max(254);
export const DisplayNameSchema = z.string().min(1).max(80).trim();

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

// ----- Endpoints -------------------------------------------------------------

export const RegisterBodySchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema,
});

export const RegisterReplySchema = z.object({
  user: UserDtoSchema,
  ...TokenPairSchema.shape,
});

export const LoginBodySchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  deviceId: z.string().min(1).max(120).optional(),
});

export const LoginReplySchema = RegisterReplySchema;

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const RefreshReplySchema = TokenPairSchema;

export const LogoutBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const LogoutReplySchema = z.object({ ok: z.literal(true) });

export const LogoutAllReplySchema = z.object({
  revokedCount: z.number().int().nonnegative(),
});

export const MeReplySchema = z.object({ user: UserDtoSchema });
