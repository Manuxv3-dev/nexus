import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config @nexus/web — SPA principale (cf. ADR-014).
 *
 * - Proxy /api et /ws vers le backend Fastify en dev (port 3000)
 * - Alias `@/...` → `src/...` pour des imports lisibles
 */
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
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
