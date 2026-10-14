import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Build de production : données du jeu déjà validées (import et serveur), pas de revalidation.
  define: command === 'build' ? { __TRUSTED_GAME_DATA__: 'true' } : {},
  // Les images pixel art sont servies telles quelles depuis assets_rpg_tour/.
  publicDir: path.resolve(root, '../assets_rpg_tour'),
  build: {
    // Le fichier des données du jeu (catalogues des classeurs) fait ~1 Mo, ~100 Ko compressé.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Bibliothèques et données du jeu dans leurs propres fichiers : ils changent rarement et
        // restent en cache quand seul le code du jeu est mis à jour.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          if (/[\\/]shared[\\/]data[\\/].+\.json$/.test(id)) return 'game-data';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      // Multijoueur : Socket.IO (WebSocket) sur le même serveur.
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
}));
