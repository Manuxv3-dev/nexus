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

export const ThemeModeSchema = z.enum(['dark', 'light', 'auto']);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

/**
 * Page d'atterrissage post-login (cf. ADR-024).
 *
 * - `home` : Home Nexus, feed personnel trans-groupes (défaut).
 * - `last_channel` : restore le dernier channel/feature consulté
 *   (le tracking se fait côté front via localStorage).
 * - `last_group_first_channel` : ouvre le 1er channel du dernier groupe actif.
 * - `last_group_first_feature` : ouvre directement la 1re feature
 *   (events) du dernier groupe actif.
 *
 * Si un fallback échoue (ex : `last_channel` mais aucun localStorage,
 * ou groupe supprimé), le front retombe silencieusement sur `home`.
 */
export const LandingPreferenceSchema = z.enum([
  'home',
  'last_channel',
  'last_group_first_channel',
  'last_group_first_feature',
]);
export type LandingPreference = z.infer<typeof LandingPreferenceSchema>;

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  /**
   * Préférence de thème UI. Null si l'utilisateur n'a jamais touché au
   * switcher ; le front retombe alors sur son défaut (typiquement 'auto').
   */
  themePreference: ThemeModeSchema.nullable(),
  /**
   * Page d'atterrissage post-login (cf. ADR-024). NOT NULL côté DB
   * avec défaut 'home' — pas de cas null à gérer côté front.
   */
  landingPreference: LandingPreferenceSchema,
  createdAt: z.string().datetime(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

/**
 * Body accepté par PATCH /api/v1/auth/me. Champs facultatifs : on n'update
 * que ce qui est présent. Pour J5b #50 on a ajouté `themePreference` — pour
 * #69 (ADR-024) on ajoute `landingPreference`. Les autres champs
 * (displayName, avatarUrl…) viendront ensuite si besoin.
 */
export const UpdateMeBodySchema = z.object({
  themePreference: ThemeModeSchema.nullable().optional(),
  landingPreference: LandingPreferenceSchema.optional(),
});
export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;

/**
 * Mode web (cookie + CSRF) : refreshToken absent du body et de la réponse,
 * remplacé par les cookies `nexus_refresh` (httpOnly) et `nexus_csrf`.
 * Mode native (body-token) : refreshToken présent dans le body et la réponse.
 *
 * Cf. ADR-015 pour le détail.
 */
export const TokenPairSchema = z.object({
  accessToken: z.string(),
  /** Présent en mode native, absent en mode web (transporté en cookie). */
  refreshToken: z.string().optional(),
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

/**
 * Refresh body : `refreshToken` est optionnel pour permettre le mode web
 * où le refresh est transporté via cookie. Le handler vérifie qu'il y a
 * exactement une source (body OU cookie, pas les deux, pas aucun).
 */
export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const RefreshReplySchema = TokenPairSchema;

export const LogoutBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const LogoutReplySchema = z.object({ ok: z.literal(true) });

export const LogoutAllReplySchema = z.object({
  revokedCount: z.number().int().nonnegative(),
});

export const MeReplySchema = z.object({ user: UserDtoSchema });
