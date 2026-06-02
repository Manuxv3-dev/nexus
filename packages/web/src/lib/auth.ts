/**
 * Store auth — tient l'utilisateur courant + gère le refresh silencieux.
 */
import { z } from 'zod';
import { create } from 'zustand';

import { api, setAccessToken, setOnAuthExpired } from './api';
import { useTheme } from './theme';

/**
 * Page d'atterrissage post-login (cf. ADR-024). Cf. backend
 * `LandingPreferenceSchema` dans `routes/auth/schemas.ts` — on duplique
 * le schéma ici car les schémas UserDto ne sont pas (encore) exportés via
 * @nexus/shared (dette à résorber en J6 quand on bougera plus de DTOs).
 */
export const LandingPreferenceSchema = z.enum([
  'home',
  'last_channel',
  'last_group_first_channel',
  'last_group_first_feature',
]);
export type LandingPreference = z.infer<typeof LandingPreferenceSchema>;

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  themePreference: z.enum(['dark', 'light', 'auto']).nullable(),
  landingPreference: LandingPreferenceSchema,
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

const TokenPairReply = z.object({
  user: UserSchema,
  accessToken: z.string(),
  refreshToken: z.string().optional(),
});

const RefreshReply = z.object({ accessToken: z.string() });
const MeReply = z.object({ user: UserSchema });
const OkReply = z.object({ ok: z.literal(true) });

interface AuthState {
  user: User | null;
  /** undefined = pas encore tenté ; true = checking ; false = idle. */
  initializing: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, displayName: string) => Promise<User>;
  forgotPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Révoque toutes les autres sessions de l'utilisateur (cf. ADR-004).
   * La session courante reste valide (le serveur garde le refresh token actif
   * uniquement pour l'appareil qui appelle l'endpoint).
   */
  logoutAll: () => Promise<number>;
  setUser: (user: User | null) => void;
  /**
   * Met à jour la préférence de page d'atterrissage (cf. ADR-024). Pousse au
   * backend (PATCH /auth/me) puis met à jour le user local en optimiste.
   * Best-effort : si le backend échoue, le state local est rollback.
   */
  setLandingPreference: (pref: LandingPreference) => Promise<void>;
  /**
   * Met à jour le profil (nom d'affichage et/ou email) via PATCH /auth/me
   * (cf. ADR-033) puis re-sync le user local. Throw `ApiError` (ex.
   * `AUTH_EMAIL_TAKEN` 409) que l'appelant affiche.
   */
  updateProfile: (patch: { displayName?: string; email?: string }) => Promise<void>;
  /**
   * Change le mot de passe via POST /auth/change-password (cf. ADR-033).
   * Côté serveur tous les refresh tokens sont révoqués ; la session courante
   * vit jusqu'à expiration de l'access token. Throw sur mauvais mdp actuel.
   */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /**
   * Supprime définitivement le compte (RGPD) via DELETE /auth/me (cf. ADR-033)
   * puis vide l'état local (déconnexion). Le serveur transfère la propriété
   * des groupes au plus ancien autre membre ou les supprime si membre unique.
   */
  deleteAccount: () => Promise<void>;
}

// Déduplication : `init()` peut être appelé plusieurs fois par React (notamment
// en StrictMode dev qui monte/démonte chaque composant deux fois). Sans
// déduplication, on lance N refresh tokens en parallèle, dont seul le 1er
// rotate le token côté backend ; les suivants utilisent le token déjà rotaté
// et se prennent un `AUTH_REFRESH_REUSED` qui révoque TOUTES les sessions.
// Cf. logs serveur : "Refresh token reused — all sessions revoked".
let initInFlight: Promise<void> | null = null;

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  initializing: true,

  async init() {
    if (initInFlight) return initInFlight;
    initInFlight = (async () => {
      set({ initializing: true });
      try {
        // Tente un refresh : si on a un cookie httpOnly valide, on récupère un access token.
        const refreshed = await api({
          method: 'POST',
          path: '/auth/refresh',
          body: {},
          reply: RefreshReply,
          noRetry: true,
          unauthenticated: true,
        });
        setAccessToken(refreshed.accessToken);
        const me = await api({ method: 'GET', path: '/auth/me', reply: MeReply });
        set({ user: me.user });
        // Sync theme depuis le serveur (peut être différent du localStorage si
        // l'user s'est connecté depuis un autre device).
        useTheme.getState().syncFromServer(me.user.themePreference);
      } catch {
        setAccessToken(null);
        set({ user: null });
      } finally {
        set({ initializing: false });
      }
    })();
    try {
      await initInFlight;
    } finally {
      initInFlight = null;
    }
  },

  async login(email, password) {
    const reply = await api({
      method: 'POST',
      path: '/auth/login',
      body: { email, password },
      reply: TokenPairReply,
      unauthenticated: true,
    });
    setAccessToken(reply.accessToken);
    set({ user: reply.user });
    useTheme.getState().syncFromServer(reply.user.themePreference);
    return reply.user;
  },

  async register(email, password, displayName) {
    const reply = await api({
      method: 'POST',
      path: '/auth/register',
      body: { email, password, displayName },
      reply: TokenPairReply,
      unauthenticated: true,
    });
    setAccessToken(reply.accessToken);
    set({ user: reply.user });
    useTheme.getState().syncFromServer(reply.user.themePreference);
    return reply.user;
  },

  async forgotPassword(email) {
    // L'endpoint exact est défini en J1f. En attendant on s'attend à 204 ou 404.
    try {
      await api({
        method: 'POST',
        path: '/auth/forgot-password',
        body: { email },
        unauthenticated: true,
      });
    } catch (err) {
      // On masque l'erreur côté UI : la convention est de toujours répondre 204
      // pour ne pas révéler l'existence d'un compte.
      console.warn('[auth] forgotPassword endpoint indisponible', err);
    }
  },

  async logout() {
    try {
      await api({ method: 'POST', path: '/auth/logout', body: {} });
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
    void get();
  },

  async logoutAll() {
    const reply = await api({
      method: 'POST',
      path: '/auth/logout-all',
      body: {},
      reply: z.object({ revokedCount: z.number().int().nonnegative() }),
    });
    return reply.revokedCount;
  },

  setUser(user) {
    set({ user });
  },

  async setLandingPreference(pref) {
    const current = get().user;
    if (!current) return;
    // Optimistic update : on applique tout de suite, on rollback si KO.
    set({ user: { ...current, landingPreference: pref } });
    try {
      const reply = await api({
        method: 'PATCH',
        path: '/auth/me',
        body: { landingPreference: pref },
        reply: MeReply,
      });
      // Re-sync depuis la source de vérité serveur (au cas où d'autres champs
      // ont changé en parallèle).
      set({ user: reply.user });
    } catch (err) {
      // Rollback à l'ancienne valeur.
      set({ user: current });
      throw err;
    }
  },

  async updateProfile(patch) {
    const reply = await api({ method: 'PATCH', path: '/auth/me', body: patch, reply: MeReply });
    set({ user: reply.user });
  },

  async changePassword(currentPassword, newPassword) {
    await api({
      method: 'POST',
      path: '/auth/change-password',
      body: { currentPassword, newPassword },
      reply: OkReply,
    });
  },

  async deleteAccount() {
    try {
      await api({ method: 'DELETE', path: '/auth/me', reply: OkReply });
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },
}));

// Branche le hook 401 → reset auth.
setOnAuthExpired(() => {
  setAccessToken(null);
  useAuth.setState({ user: null });
});
