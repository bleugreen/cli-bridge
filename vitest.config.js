import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['*.js', 'lib/**/*.js'],
      exclude: ['vitest.config.js', 'tests/**'],
    },
    testTimeout: 10000,
  },
});
