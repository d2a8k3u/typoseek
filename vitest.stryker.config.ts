import { defineConfig } from 'vitest/config';
import vitestConfig from './vitest.config.ts';

const INSTRUMENTED_TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  ...vitestConfig,
  test: {
    ...vitestConfig.test,
    include: ['test/unit/**/*.test.ts'],
    testTimeout: INSTRUMENTED_TEST_TIMEOUT_MS,
    coverage: { enabled: false },
  },
});
