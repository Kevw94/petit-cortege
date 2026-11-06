import { defineConfig } from 'vite';

/** Port du serveur Node en dev (voir scripts/dev.ts). */
const PORT_SERVEUR = Number(process.env.PORT_SERVEUR ?? 8787);

export default defineConfig({
  server: {
    host: true,
    port: Number(process.env.PORT_CLIENT ?? 5173),
    proxy: {
      // Fichiers publiés : servis par le serveur en dev, par le CDN en prod.
      '/publie': `http://127.0.0.1:${PORT_SERVEUR}`,
      '/api': `http://127.0.0.1:${PORT_SERVEUR}`,
    },
  },
});
