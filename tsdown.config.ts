import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    serialize: 'src/serialize.ts',
    segmenter: 'src/segmenter.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  fixedExtension: true,
  platform: 'neutral',
  target: 'es2022',
  tsconfig: 'tsconfig.build.json',
  minify: false,
  sourcemap: false,
});
