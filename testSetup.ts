import '@testing-library/jest-dom/vitest';

/**
 * Global test setup.
 *
 * Runs before every test file. Adds the jest-dom matchers (`toBeInTheDocument`, etc.) and
 * installs the environment shims the modules under test expect.
 *
 * Nothing here may paper over a real failure: these shims only provide what a Node/jsdom
 * test runner genuinely lacks (a `crypto.randomUUID`), they never stub out the logic under
 * test.
 */

// jsdom has no `crypto.randomUUID`; `lib/product-catalog.ts` uses it.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...globalThis.crypto,
      randomUUID: () => `test-uuid-${Math.random().toString(36).slice(2)}`,
    },
    writable: true,
  });
}
