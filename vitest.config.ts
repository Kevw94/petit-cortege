import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
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
          name: 'client',
          root: './client',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
