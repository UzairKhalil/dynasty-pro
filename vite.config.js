import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the built site works both at a user page (user.github.io)
// and at a project page (user.github.io/dynasty-pro/) with no repo-name edit.
// This holds only because the app uses no path-based router.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
  test: {
    // node by default so the pure rules/ledger/ai suites don't pay for jsdom;
    // the DOM suites opt in with an @vitest-environment docblock.
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.{js,jsx}']
  }
});
