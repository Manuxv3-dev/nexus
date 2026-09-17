/**
 * Store auth — tient l'utilisateur courant + gère le refresh silencieux.
 */
import { OnboardingStepSchema } from '@nexus/shared';
import { z } from 'zod';
import { create } from 'zustand';

import {
  ApiError,
  api,
  getRefreshToken,
  isSessionRejected,
  setAccessToken,
  setOnAuthExpired,
  setRefreshToken,
  tryRefresh,
} from './api';
import { dropDevicePushSubscription, reconcilePushSubscription, unsubscribeFromPush } from './push';
import { isTauri, readSecureToken } from './tauri';
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
  /**
   * Étape courante du tutoriel de découverte (cf. MAN-217 Phase 1 / MAN-220).
   * `OnboardingStepSchema` vient de `@nexus/shared` — source de vérité unique
   * avec le backend, pas de duplication (cf. dette `LandingPreference`
   * ci-dessus, qu'on ne reproduit pas ici). Null = jamais démarré.
   */
  onboardingStep: OnboardingStepSchema.nullable(),
  /**
   * Timestamp de fin du tutoriel (terminé OU passé). Null = pas terminé.
   * Cf. `packages/web/src/lib/onboardingTour.ts` pour la dérivation de statut.
   */
  onboardingCompletedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

const TokenPairReply = z.object({
  user: UserSchema,
  accessToken: z.string(),
  refreshToken: z.string().optional(),
});

/** Exporté pour `lib/onboardingTour.ts`, qui mirror le pattern optimiste +
 * rollback de `setLandingPreference` ci-dessous pour PATCH /auth/me. */
export const MeReply = z.object({ user: UserSchema });
const OkReply = z.object({ ok: z.literal(true) });

interface AuthState {
  user: User | null;
  /** undefined = pas encore tenté ; true = checking ; false = idle. */
  initializing: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, displayName: string) => Promise<User>;
  /**
   * Demande un lien de réinitialisation via POST /auth/forgot-password
   * (MAN-166). Masque toute erreur côté UI — sauf le rate limit (429,
   * MAN-172) qui est re-throw en `ApiError` : le pattern de requêtes (pas
   * l'existence du compte) a déclenché la limite, donc le laisser remonter
   * ne casse pas l'anti-énumération. L'appelant (`ForgotPasswordScreen`)
   * distingue ce cas pour afficher un message dédié.
   */
  forgotPassword: (email: string) => Promise<void>;
  /**
   * Finalise la réinitialisation via POST /auth/reset-password (MAN-166).
   * Contrairement à `forgotPassword`, ne masque PAS l'erreur : l'appelant
   * (ResetPasswordScreen) a besoin de distinguer succès et jeton
   * invalide/expiré/déjà utilisé (`AUTH_RESET_TOKEN_INVALID`) pour afficher
   * le message adapté.
   */
  resetPassword: (token: string, newPassword: string) => Promise<void>;
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
        // Mode web : le cookie httpOnly porte le token, corps vide.
        // Mode natif (ADR-038) : c'est nous qui le portons. Sans token en
        // main, il n'y a rien à rejouer — on sort en non-authentifié plutôt
        // que de provoquer un 401 certain.
        const native = isTauri();
        // Le token survit au process dans le magasin de secrets de l'OS
        // (ADR-038). `persist: false` : on vient de le lire, le réécrire à
        // l'identique n'apporterait rien.
        let stored = getRefreshToken();
        if (native && !stored) {
          stored = await readSecureToken();
          if (stored) setRefreshToken(stored, false);
        }
        if (native && !stored) {
          throw new Error('no-refresh-token');
        }
        // Passe par `tryRefresh()` (cf. api.ts) plutôt que de rappeler
        // `/auth/refresh` ici : c'est là que vit la sérialisation — dans
        // l'onglet (`refreshInFlight`) et entre onglets (Web Locks, mode
        // web — chaque onglet attend son tour puis obtient SON PROPRE
        // access token, cf. JSDoc de `withCrossTabRefreshLock`).
        // Ré-implémenter l'appel ici recréerait exactement la course
        // cross-onglet que `tryRefresh` corrige : N onglets restaurés en
        // même temps rejoueraient chacun le même cookie T0, jusqu'à la
        // cascade `AUTH_REFRESH_REUSED` (cf. ADR-040).
        const outcome = await tryRefresh();
        if (!outcome.ok) throw outcome.cause;
        const me = await api({ method: 'GET', path: '/auth/me', reply: MeReply });
        set({ user: me.user });
        // Sync theme depuis le serveur (peut être différent du localStorage si
        // l'user s'est connecté depuis un autre device).
        useTheme.getState().syncFromServer(me.user.themePreference);
        // Session confirmée valide : pendant de `dropSessionPush` côté échec
        // (cf. ticket d6772b47, plus bas).
        reconcilePushForSession(me.user.id);
      } catch (err) {
        setAccessToken(null);
        set({ user: null });
        forgetPushReconciliation();
        if (isSessionRejected(err)) {
          // Le serveur a refusé la session : le token est mort, on l'efface —
          // magasin de l'OS compris — et l'appareil lâche son push.
          //
          // Si `err` vient de `tryRefresh()` (`outcome.cause` ci-dessus),
          // `performRefreshRequest` a déjà fait cet appel une première fois
          // en cas d'échec terminal — celui-ci est alors redondant mais sans
          // risque : `setRefreshToken(null)` remet `null` sur `null`, et
          // `clearSecureToken`/`secure_token_clear` sont idempotents côté
          // Rust (`Err(NoEntry) => Ok(())`, cf. `secure_token.rs`). On le
          // garde ici tel quel plutôt que de le conditionner à la provenance
          // de l'erreur : ce même branchement gère aussi un refus tardif de
          // `/auth/me` (refresh réussi, session révoquée entre-temps), qui
          // lui n'a jamais appelé `setRefreshToken(null)`.
          setRefreshToken(null);
          dropSessionPush();
        } else {
          // Coupure réseau, 5xx, ou rien à rejouer : on ne peut pas être
          // connecté sans serveur, mais le token persisté est peut-être
          // parfaitement valide — on le laisse au magasin (`persist: false`),
          // le prochain lancement retentera (cf. 17d116dc). L'effacer ici
          // transformait un démarrage hors-ligne en déconnexion définitive.
          setRefreshToken(null, false);
        }
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
    // Présent en mode natif seulement — en mode web il est dans le cookie.
    setRefreshToken(reply.refreshToken ?? null);
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
    setRefreshToken(reply.refreshToken ?? null);
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
      // Rate limit (MAN-172) : remonté tel quel à l'appelant pour afficher un
      // message dédié — cf. JSDoc de `forgotPassword` sur l'AuthState.
      if (err instanceof ApiError && err.status === 429) {
        throw err;
      }
      // Pour toute autre erreur, on masque : la convention est de toujours
      // répondre succès pour ne pas révéler l'existence d'un compte.
      console.warn('[auth] forgotPassword endpoint indisponible', err);
    }
  },

  async resetPassword(token, newPassword) {
    await api({
      method: 'POST',
      path: '/auth/reset-password',
      body: { token, newPassword },
      reply: OkReply,
      unauthenticated: true,
    });
  },

  async logout() {
    // Désabonnement push AVANT de lâcher le token, et c'est tout le sujet
    // (cf. ticket 35c39b3a) : `DELETE /push/subscribe` ne supprime la ligne
    // que si elle appartient au `userId` appelant. Le faire après — dans un
    // effet sur changement d'identité, comme le vidage du cache de
    // `10bc1096` — enverrait un DELETE non authentifié, et l'abonnement
    // resterait attaché au compte partant.
    //
    // Sans ça, sur une machine partagée, les notifications du compte
    // précédent — avec aperçu du contenu — continuent d'arriver au suivant,
    // et ce même application fermée : c'est le service worker qui les reçoit.
    // Rien ne réattribue l'abonnement à la connexion, seul le toggle des
    // Réglages le fait.
    //
    // Best-effort : un push cassé (service worker absent, permission
    // révoquée, réseau) ne doit jamais retenir quelqu'un connecté.
    try {
      await unsubscribeFromPush();
    } catch (err) {
      console.warn('[auth] désabonnement push au logout', err);
    }
    try {
      // En mode natif le serveur n'a aucun cookie pour retrouver la session à
      // révoquer : sans ce corps, le refresh token resterait valide côté base
      // jusqu'à expiration alors que l'utilisateur croit s'être déconnecté.
      const stored = isTauri() ? getRefreshToken() : null;
      await api({
        method: 'POST',
        path: '/auth/logout',
        body: stored ? { refreshToken: stored } : {},
      });
    } finally {
      setAccessToken(null);
      setRefreshToken(null);
      set({ user: null });
      forgetPushReconciliation();
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
      setRefreshToken(null);
      set({ user: null });
      forgetPushReconciliation();
    }
  },
}));

/**
 * Une session qui tombe SANS logout lâche l'abonnement push de l'appareil
 * (cf. ticket 686f4eea, lacune assumée de 35c39b3a). `logout()` a le luxe de
 * désabonner pendant que le token est encore posé ; ici il est déjà mort, un
 * DELETE partirait en 401 — d'où `dropDevicePushSubscription`, côté navigateur
 * seulement. Sans ça, sur une machine partagée, les notifications de A — avec
 * aperçu — continueraient d'arriver au suivant, application fermée comprise.
 *
 * Fire-and-forget et best-effort : la session est déjà fermée quand on
 * arrive ici, un push cassé n'a rien à retenir.
 */
function dropSessionPush(): void {
  dropDevicePushSubscription().catch((err: unknown) => {
    console.warn("[auth] désabonnement push à l'expiration de session", err);
  });
}

// Dédup de `reconcilePushForSession` ci-dessous — déclarée ici, avant son
// JSDoc, pour que celui-ci s'attache sans ambiguïté à la fonction plutôt
// qu'à cette variable.
let pushReconciledForUserId: string | null = null;

/**
 * Pendant de `dropSessionPush` ci-dessus, côté succès : au montage d'une
 * session authentifiée VALIDE, ré-envoie l'abonnement push existant du
 * navigateur au serveur (cf. ticket d6772b47, lacune de MAN-146 phase 5).
 *
 * Répare un faux positif du nettoyage automatique serveur (404/410 du push
 * service alors que l'abonnement navigateur est en fait toujours bon — un
 * proxy ou portail captif qui répond « gone » à sa place) : sans ça, rien
 * n'informe le navigateur que sa ligne `push_subscriptions` a été purgée, et
 * le toggle Settings continue d'afficher « activé » alors qu'aucun push ne
 * peut plus arriver. `POST /push/subscribe` est un upsert par `endpoint` (cf.
 * `subscribeUser`, `routes/push/repo.ts`) : il restaure la ligne si elle a
 * été purgée à tort, et sinon la met simplement à jour — depuis abf71bf4
 * (#100) il rebinde aussi `sessionId` à la session courante, ce qui répare
 * en prime un abonnement orphelin d'une session morte (aucun changement
 * client requis, la route le fait à partir du JWT).
 *
 * Dédupliquée par `userId`, pas par un simple booléen : un double montage de
 * l'effet racine (StrictMode dev, cf. commentaire de `initInFlight`) ou un
 * `init()` rejoué pour la MÊME session ne doit renvoyer qu'un seul POST,
 * mais une session différente (logout/login, y compris d'un autre compte sur
 * une machine partagée) doit pouvoir redéclencher la réconciliation — cf.
 * `forgetPushReconciliation` ci-dessous, appelée partout où `user` retombe à
 * `null`.
 *
 * Fire-and-forget et best-effort, même style que `dropSessionPush` : un push
 * cassé ou un réseau coupé ne doit ni bloquer le montage de l'app ni afficher
 * de toast.
 */
function reconcilePushForSession(userId: string): void {
  if (pushReconciledForUserId === userId) return;
  pushReconciledForUserId = userId;
  reconcilePushSubscription().catch((err: unknown) => {
    console.warn('[auth] réconciliation abonnement push au montage', err);
  });
}

/**
 * Oublie la dernière réconciliation faite par `reconcilePushForSession` — à
 * appeler partout où `user` retombe à `null` (logout, suppression de compte,
 * `init()` en échec, expiration de session). Sans ça, un
 * logout(A) → login(A) → purge serveur de la ligne → prochain `init()` de A
 * se ferait ignorer par le dédup `userId`, puisque cet id a déjà été
 * « réconcilié » lors de la session précédente : le toggle Settings resterait
 * à ON sans que rien ne le répare, exactement le bug que ce ticket corrige.
 */
function forgetPushReconciliation(): void {
  pushReconciledForUserId = null;
}

// Branche le hook 401 → reset auth. Depuis 17d116dc, `api.ts` ne le
// déclenche que sur un échec TERMINAL du refresh (refus du serveur, ou rien à
// rejouer) : un échec transitoire laisse l'app connectée. `cause` reste
// qualifiée par prudence : seul un refus du serveur lâche le push (cf.
// `isSessionRejected`), rien à lâcher quand il n'y avait rien à rejouer.
setOnAuthExpired((cause) => {
  setAccessToken(null);
  setRefreshToken(null);
  useAuth.setState({ user: null });
  forgetPushReconciliation();
  if (isSessionRejected(cause)) dropSessionPush();
});
