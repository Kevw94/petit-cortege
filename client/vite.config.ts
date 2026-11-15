import { defineConfig } from 'vite';

/** Port du serveur Node en dev (voir scripts/dev.ts). */
const PORT_SERVEUR = Number(process.env.PORT_SERVEUR ?? 8787);

export default defineConfig({
  // Pré-optimisé : sinon Vite découvre le worker ALTCHA au premier clic et recharge la page.
  optimizeDeps: { include: ['altcha-lib', 'altcha-lib/algorithms/web/pbkdf2'] },
  server: {
    host: true,
    port: Number(process.env.PORT_CLIENT ?? 5173),
    proxy: {
      // Fichiers publiés : servis par le serveur en dev comme en production.
      '/publie': `http://127.0.0.1:${PORT_SERVEUR}`,
      '/api': `http://127.0.0.1:${PORT_SERVEUR}`,
    },
  },
});
