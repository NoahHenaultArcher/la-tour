import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['shared', 'server', 'scripts'],
    // Chaque worker valide les données au chargement : on laisse de la marge quand tout tourne en parallèle.
    testTimeout: 20_000,
  },
});
