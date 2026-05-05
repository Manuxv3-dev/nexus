import type { QueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth';
import { isTauri } from '@/lib/tauri';
import { useKillerFeaturesWs } from '@/lib/useKillerFeaturesWs';
import { useIsMobile } from '@/lib/useMedia';
import { AppShell } from '@/screens/app/AppShell';
import { MobileShell } from '@/screens/app/MobileShell';
import { TitleBar } from '@/screens/app/TitleBar';
import { ForgotPasswordScreen } from '@/screens/auth/ForgotPasswordScreen';
import { InviteRedirectScreen } from '@/screens/auth/InviteRedirectScreen';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { OnboardingScreen } from '@/screens/auth/OnboardingScreen';
import { RegisterScreen } from '@/screens/auth/RegisterScreen';
import { LandingScreen } from '@/screens/landing/LandingScreen';
import { OAuthCallbackScreen } from '@/screens/oauth/OAuthCallbackScreen';
import { PublicEventScreen } from '@/screens/public/PublicEventScreen';
import { PublicExpenseScreen } from '@/screens/public/PublicExpenseScreen';
import { PublicListScreen } from '@/screens/public/PublicListScreen';
import { PublicPollScreen } from '@/screens/public/PublicPollScreen';
import { PublicTodoScreen } from '@/screens/public/PublicTodoScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const init = useAuth((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  // Synchro WS killer features (events / polls / expenses / todos)
  // active sur toutes les routes auth — y compris pages publiques
  // ouvertes par un membre du groupe.
  useKillerFeaturesWs();
  // Window controls Tauri (cf. ADR-026 borderless) — boutons floating
  // intégrés DANS la window via overlay, plus une drag region invisible
  // en haut. En mode navigateur web pur, le composant ne rend rien.
  // Le contenu reste full-height (TitleBar n'occupe pas de place dans le flow).
  return (
    <>
      <TitleBar />
      <Outlet />
    </>
  );
}

/**
 * Polish post-ADR-027 : en mode Tauri (app desktop), la landing page
 * publique marketing n'a aucun sens — l'user a déjà installé l'app, il
 * veut son login. On bypass donc directement vers /login (ou /app si
 * une session est active).
 *
 * En mode navigateur web pur, render LandingScreen normalement.
 */
function IndexComponent() {
  const navigate = useNavigate();
  const { user, initializing } = useAuth();

  useEffect(() => {
    if (!isTauri()) return;
    if (initializing) return;
    void navigate({ to: user ? '/app' : '/login', replace: true });
  }, [user, initializing, navigate]);

  // Mode Tauri : on attend la décision auth, on ne flash pas la landing.
  if (isTauri()) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
          color: '#fff',
          fontSize: 14,
        }}
      >
        <span style={{ animation: 'spinSlow 1s linear infinite' }}>⟳</span>
      </div>
    );
  }
  return <LandingScreen />;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexComponent,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginScreen,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterScreen,
});
const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordScreen,
});
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingScreen,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$slug',
  component: InviteRedirectScreen,
});

function ResponsiveAppShell() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileShell /> : <AppShell />;
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: ResponsiveAppShell,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsScreen,
});

const oauthCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  // Une seule route paramétrée pour tous les providers (discord, whatsapp,
  // messenger). La page lit elle-même `?provider=...&sessionId=...&groupId=...`.
  path: '/oauth/callback',
  component: OAuthCallbackScreen,
});

const publicEventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/e/$slug',
  component: PublicEventScreen,
});
const publicPollRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug',
  component: PublicPollScreen,
});
const publicExpenseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/d/$slug',
  component: PublicExpenseScreen,
});
const publicTodoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$slug',
  component: PublicTodoScreen,
});
const publicListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/l/$slug',
  component: PublicListScreen,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotRoute,
  onboardingRoute,
  inviteRoute,
  appRoute,
  settingsRoute,
  oauthCallbackRoute,
  publicEventRoute,
  publicPollRoute,
  publicExpenseRoute,
  publicTodoRoute,
  publicListRoute,
]);
