import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { main: 'demo/main.ts' },
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  tsconfig: 'demo/tsconfig.json',
  outDir: 'demo/dist',
  dts: false,
  clean: true,
  minify: true,
});
