import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './shared',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'server',
          root: './server',
          include: ['test/**/*.test.ts'],
          // Vrai Postgres : une base jetable par fichier de test.
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'scripts',
          root: './scripts',
          include: ['test/**/*.test.ts'],
          // Vrai Postgres (base jetable) et sous-processus.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'client',
          root: './client',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
