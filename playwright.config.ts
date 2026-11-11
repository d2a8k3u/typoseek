import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/demo',
  testMatch: '*.spec.ts',
  reporter: 'list',
  use: { browserName: 'chromium' },
});
