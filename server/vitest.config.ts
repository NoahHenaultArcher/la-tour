import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Les tests d'intégration partagent la même base : un seul processus, un fichier à la fois.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
