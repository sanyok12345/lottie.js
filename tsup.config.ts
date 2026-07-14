import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/lottie.ts'],
  format: ['esm', 'cjs'],
  clean: true,
  treeshake: true,
  sourcemap: false,
  minify: false,
  dts: false,
});
