import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js', 'engine/tests/**/*.test.js'],
    exclude: ['tests/e2e/**'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['providers/**/*.js', 'shared/**/*.js', 'content/**/*.js']
    },
    setupFiles: ['tests/helpers/setup.js'],
    mockGlobals: true
  }
});
