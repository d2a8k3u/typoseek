import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDirectory = fileURLToPath(new URL('./src', import.meta.url));

const fullCoverage = { lines: 100, branches: 100, functions: 100, statements: 100 };

export default defineConfig({
  resolve: {
    alias: [
      { find: /^typoseek$/, replacement: `${srcDirectory}/index.ts` },
      { find: /^typoseek\/(.+)$/, replacement: `${srcDirectory}/$1.ts` },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
        'src/core/**': fullCoverage,
      },
    },
  },
});
