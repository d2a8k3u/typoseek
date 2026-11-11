import { defineConfig } from 'vitest/config';
import vitestConfig from './vitest.config.ts';

export default defineConfig({
  ...vitestConfig,
  test: {
    ...vitestConfig.test,
    include: ['test/unit/**/*.test.ts'],
    coverage: { enabled: false },
  },
});
