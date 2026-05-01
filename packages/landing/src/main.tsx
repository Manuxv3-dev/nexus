/**
 * Landing entry point — sert nexusapp.chat (cf. ADR-014 J4-pre).
 *
 * Note : ce package importe directement les sources de @nexus/web via
 * l'alias `@web/...` configuré dans vite.config.ts. C'est volontaire :
 *  - on ne fait PAS de subpath exports complexes
 *  - on ne dupplique PAS le LandingScreen
 *  - on garde une SPA ultra-légère uniquement pour la landing publique
 *
 * Les imports `@/` dans LandingScreen continuent de fonctionner parce que
 * l'alias `@/` est aussi configuré pour pointer vers packages/web/src.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// L'alias @web/ pointe vers ../web/src dans vite.config.ts.
// L'alias @/ est déjà résolu côté @nexus/web vers packages/web/src.
// eslint-disable-next-line import/no-unresolved
import { LandingScreen } from '@web/screens/landing/LandingScreen';

// eslint-disable-next-line import/no-unresolved
import '@web/styles/global.css';

const queryClient = new QueryClient();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root introuvable');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LandingScreen />
    </QueryClientProvider>
  </StrictMode>,
);
