export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.stryker.config.ts' },
  mutate: ['src/core/**/*.ts'],
  thresholds: { high: 90, low: 80, break: 80 },
};
