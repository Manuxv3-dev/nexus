import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Landing Vite — déployée sur `nexusapp.chat` pendant la phase pre-launch
 * (cf. ADR-014 J4-pre). Statique, légère.
 *
 * Réutilise le code de `@nexus/web` via un alias `@web/...` plutôt qu'une
 * dépendance npm, parce que la landing partage les mêmes tokens, icônes et
 * composants UI sans surface API publique.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // L'alias `@/` est partagé avec @nexus/web pour que les composants
      // importés (tokens, ui, lib/api) continuent de résoudre correctement
      // depuis la landing.
      '@': fileURLToPath(new URL('../web/src', import.meta.url)),
      '@web': fileURLToPath(new URL('../web/src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
