import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    // Integration-style UI tests can exceed 5s when the machine is also
    // building or running the backend suite. This is a load allowance, not a
    // relaxation of any assertion.
    testTimeout: 10_000,
    hookTimeout: 10_000,
  } as any,
});
