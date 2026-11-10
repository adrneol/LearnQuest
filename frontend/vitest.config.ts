import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // jsdom uses Vite's TS/JSX transform without the dev proxy, Tailwind build,
  // or local dotenv settings. Real CSS is exercised by the browser suite.
  envDir: false,
  test: {
    environment: 'jsdom',
    include: mode === 'known-defects'
      ? ['tests/known-defects/**/*.test.{ts,tsx}']
      : ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: mode === 'known-defects'
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'tests/known-defects/**'],
    setupFiles: ['./src/test-setup.ts'],
    // Avoid starting a fresh Node process for each test file on Windows.
    pool: 'threads',
    maxWorkers: 2,
    // The whole-test budget accommodates multi-step flows on slower hosts.
    // Testing Library still bounds each UI wait separately.
    testTimeout: 20_000,
    hookTimeout: 10_000,
  },
}));
