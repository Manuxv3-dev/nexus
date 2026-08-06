import { OnboardingStepSchema } from '@nexus/shared';
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

/**
 * Longueur maximale d'une adresse email (RFC 5321). Exportée : le
 * `keyGenerator` du rate limit par email de /forgot-password (routes/auth/index.ts)
 * doit borner la même valeur, car il tourne AVANT ce schéma (hook preHandler).
 */
export const EMAIL_MAX_LENGTH = 254;

export const EmailSchema = z.string().email().max(EMAIL_MAX_LENGTH);
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
  /**
   * Étape courante du tutoriel de découverte (cf. MAN-217 Phase 1 / MAN-220,
   * `OnboardingStepSchema` dans @nexus/shared). Null = jamais démarré.
   */
  onboardingStep: OnboardingStepSchema.nullable(),
  /**
   * Timestamp de fin du tutoriel — posé quand il est terminé OU passé
   * (skip). Null = pas encore terminé. Remis à null pour un replay
   * volontaire (avec `onboardingStep` = 'create_group').
   *
   * Toujours dérivé côté SERVEUR (`new Date()`, MAN-232) : le client ne pose
   * plus jamais cette valeur directement, il n'envoie qu'un intent
   * (`onboardingCompleted`, cf. `UpdateMeBodySchema`). Cette forme de
   * réponse (ISO string, nullable) ne change pas.
   */
  onboardingCompletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

/**
 * Body accepté par PATCH /api/v1/auth/me. Champs facultatifs : on n'update
 * que ce qui est présent. Préférences UI : `themePreference` (J5b #50),
 * `landingPreference` (ADR-024 #69). Identité (ADR-033) : `displayName`,
 * `email` (email lowercased-unique → AUTH_EMAIL_TAKEN en cas de collision).
 * Tutoriel de découverte (MAN-220) : `onboardingStep`, `onboardingCompleted`
 * — tous deux nullable pour permettre un reset explicite (replay).
 *
 * `onboardingCompleted` (MAN-232, suite de revue de code MAN-220) : un
 * **intent**, pas un timestamp — seule la date choisie par le SERVEUR est
 * écrite en base (`new Date()`, cf. `routes/auth/index.ts`). Avant MAN-232,
 * le champ (`onboardingCompletedAt`) acceptait une date ISO fournie par le
 * client : rien ne l'exploitait encore comme une valeur (seule sa
 * présence/absence comptait), mais la porte restait ouverte à une date
 * arbitraire — passée, future, ou absurde — le jour où elle serait lue
 * (analytics d'activation, etc.). `z.literal(true)` plutôt que `z.boolean()` :
 * un `onboardingCompleted: false` n'a aucun sens métier (ni "pas encore
 * terminé" — c'est l'état par défaut, absence du champ — ni "reset" — c'est
 * `null` qui porte ce sens, symétrique à `onboardingStep: null` juste
 * au-dessus) ; l'interdire au niveau du schéma plutôt que de le tolérer en
 * silence est plus honnête sur le contrat.
 *  - absent → champ non touché (mécanisme de présence inchangé, cf.
 *    `'onboardingCompleted' in req.body` dans le handler) ;
 *  - `true` → marque le tutoriel terminé, le serveur pose `new Date()` ;
 *  - `null` → reset explicite (replay), symétrique à `onboardingStep: null`.
 *
 * Un `true` répété (ex : un second appel après que le tutoriel est déjà
 * terminé) RÉ-ÉCRASE la date existante avec un nouveau `new Date()` — pas de
 * "first-write-wins". C'est voulu : replay → re-finish est un cas légitime
 * (`replayOnboardingTour` pose `onboardingCompleted: null`, un parcours
 * complet le repose ensuite à `true`) et DOIT avancer la date, sinon la
 * donnée d'activation visée par ce ticket daterait le PREMIER passage du
 * tutoriel plutôt que le dernier. Un second `true` sans reset entre-deux est
 * en pratique quasi inatteignable côté UI (`OnboardingTourBanner` démonte dès
 * `status === 'finished'`), donc le coût de ce choix est nul.
 *
 * `onboardingCompletedAt` (déprécié, MAN-232) : alias LEGACY conservé
 * UNIQUEMENT pour la fenêtre de rollout du desktop Tauri figé (`frontendDist`
 * dans `tauri.conf.json` — un merge sur `main` ne redéploie QUE le backend et
 * le web, jamais le desktop déjà installé ; la v0.5.0 publiée avant ce ticket
 * envoie encore l'ancien contrat et continuera de le faire jusqu'à ce que
 * l'auto-updater livre une release plus récente ET que l'utilisateur
 * relance l'app). Sans cet alias, un desktop figé enverrait une clé que Zod
 * strip silencieusement (clé inconnue) → `req.body` parsé vide →
 * `'onboardingCompleted' in req.body` faux → PATCH un no-op qui répond 200 →
 * le client remplace son état optimiste par le `null` du serveur → le
 * bandeau d'onboarding réapparaît, de façon indéfinie et sans erreur visible.
 * La valeur envoyée par ce champ legacy est TOUJOURS ignorée — seule sa
 * PRÉSENCE et sa nullité comptent (même garantie de sécurité que
 * `onboardingCompleted`, cf. handler `routes/auth/index.ts` : `else if`,
 * seul `onboardingCompleted` prime si les deux sont fournis). À supprimer une
 * fois la base desktop installée raisonnablement à jour (quelques releases
 * après MAN-232) — ne pas le laisser traîner indéfiniment.
 */
export const UpdateMeBodySchema = z.object({
  themePreference: ThemeModeSchema.nullable().optional(),
  landingPreference: LandingPreferenceSchema.optional(),
  displayName: DisplayNameSchema.optional(),
  email: EmailSchema.optional(),
  onboardingStep: OnboardingStepSchema.nullable().optional(),
  onboardingCompleted: z.literal(true).nullable().optional(),
  /** @deprecated Alias legacy desktop figé — cf. JSDoc ci-dessus. */
  onboardingCompletedAt: z.string().datetime().nullable().optional(),
});
export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;

/**
 * Body de POST /api/v1/auth/change-password (ADR-033). `newPassword` réutilise
 * `PasswordSchema` (min 12) pour rester cohérent avec register/login.
 */
export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: PasswordSchema,
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;

/** Réponse générique des actions de compte (change-password, delete). */
export const OkReplySchema = z.object({ ok: z.literal(true) });

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

/**
 * Body de POST /api/v1/auth/forgot-password (MAN-171, phase 1 de MAN-166
 * « mot de passe oublié — reset complet »). Un simple email : la réponse est
 * TOUJOURS `{ ok: true }` (cf. `OkReplySchema`) quel que soit le résultat réel
 * côté serveur — ne jamais laisser deviner si l'email correspond à un compte
 * (cf. `requestPasswordReset`, routes/auth/service.ts).
 */
export const ForgotPasswordBodySchema = z.object({
  email: EmailSchema,
});
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;

/**
 * Body de POST /api/v1/auth/reset-password (MAN-171, phase 1 de MAN-166
 * « mot de passe oublié — reset complet »). `token` est la valeur brute reçue
 * par email (cf. `generateResetToken`) ; `newPassword` réutilise
 * `PasswordSchema` (min 12) pour rester cohérent avec register/change-password.
 * Pas de `requireAuth` sur cette route : l'utilisateur n'est pas connecté.
 */
export const ResetPasswordBodySchema = z.object({
  token: z.string().min(1),
  newPassword: PasswordSchema,
});
export type ResetPasswordBody = z.infer<typeof ResetPasswordBodySchema>;
