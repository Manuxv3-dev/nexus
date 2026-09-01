import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config @nexus/web — SPA principale (cf. ADR-014).
 *
 * - Proxy /api et /ws vers le backend Fastify en dev (port 3000 par défaut)
 * - Alias `@/...` → `src/...` pour des imports lisibles
 */

/**
 * Cible du proxy de dev, surchargeable par `NEXUS_DEV_API_TARGET`.
 *
 * Par défaut le backend local. La surcharge sert deux cas concrets :
 *
 *  1. **Tester le front de dev contre une API distante** sans se heurter au
 *     CORS. `VITE_API_BASE` ne convient pas pour ça : il fait appeler l'API en
 *     absolu, donc cross-origin depuis `localhost:5173`, et la liste blanche de
 *     prod (cf. `server.ts`) ne contient que `app.nexusapp.chat` et les
 *     origines `tauri.localhost` — le preflight est rejeté. En passant par le
 *     proxy, le navigateur reste en same-origin et c'est Vite qui parle à
 *     l'API, côté serveur : plus de CORS du tout.
 *  2. **Contourner un port 3000 déjà pris** par un autre projet, sans avoir à
 *     l'arrêter.
 *
 * Attention en pointant sur une API distante : les cookies posés en `Secure`
 * sont rejetés par le navigateur sur `http://localhost`, donc la session ne
 * survit pas à un rechargement (le login lui-même marche — l'access token
 * transite dans le corps de la réponse, cf. `lib/api.ts`).
 */
const API_TARGET = process.env.NEXUS_DEV_API_TARGET ?? 'http://127.0.0.1:3000';

// Une cible distante impose de réécrire le `Host` (sinon le reverse proxy en
// face reçoit `localhost:5173` et ne sait pas router). En local on garde le
// comportement d'origine : `Host` inchangé pour matcher `WEB_BASE_URL`.
const IS_REMOTE_TARGET = !/(127\.0\.0\.1|localhost)/.test(API_TARGET);
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // host = 127.0.0.1 explicite (au lieu de 'localhost') pour matcher
    // WEB_BASE_URL côté backend et éviter les bizarreries IPv4/IPv6 sur Windows.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: IS_REMOTE_TARGET },
      '/ws': {
        // `ws://` suit `http://`, `wss://` suit `https://`.
        target: API_TARGET.replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: IS_REMOTE_TARGET,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
