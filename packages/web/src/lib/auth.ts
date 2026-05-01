/**
 * Store auth — tient l'utilisateur courant + gère le refresh silencieux.
 */
import { z } from 'zod';
import { create } from 'zustand';

import { api, setAccessToken, setOnAuthExpired } from './api';

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
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
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  initializing: true,

  async init() {
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
    } catch {
      setAccessToken(null);
      set({ user: null });
    } finally {
      set({ initializing: false });
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
    return reply.user;
  },

  async forgotPassword(email) {
    // L'endpoint exact est défini en J1f. En attendant on s'attend à 204 ou 404.
    try {
      await api({ method: 'POST', path: '/auth/forgot-password', body: { email }, unauthenticated: true });
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
}));

// Branche le hook 401 → reset auth.
setOnAuthExpired(() => {
  setAccessToken(null);
  useAuth.setState({ user: null });
});
