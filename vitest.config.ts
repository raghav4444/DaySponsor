import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest configuration.
 *
 * The project's test tooling (vitest, jsdom, @testing-library/react, jest-dom) was already
 * declared in `package.json` but had no config and no setup file, so `npm test` had never
 * run. This stands the runner up.
 *
 * No `@vitejs/plugin-react` dependency is added: Vite's built-in esbuild JSX transform
 * handles `.tsx`, which is all the component tests need. Fast Refresh is a dev-only
 * feature and is irrelevant in a test run.
 */
export default defineConfig({
  plugins: [],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./testSetup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.ts', 'components/auction/**/*.tsx'],
      exclude: ['lib/auction-rpc-stubs.ts', '**/*.test.*'],
    },
  },
});
