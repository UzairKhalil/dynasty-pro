import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// One id per deploy. CI builds carry the commit; a local build gets a
// timestamp so it never matches a deployed one by accident.
const BUILD_ID = (process.env.GITHUB_SHA || '').slice(0, 12) || `local-${Date.now()}`;

// Ships version.json next to index.html. Running pages poll it and reload into
// a new deploy when it changes (src/net/version.js) -- phones keep tabs open for
// days, and otherwise keep running whatever JavaScript they first loaded.
function versionFile() {
  return {
    name: 'dynasty-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    }
  };
}

// Relative base so the built site works both at a user page (user.github.io)
// and at a project page (user.github.io/dynasty-pro/) with no repo-name edit.
// This holds only because the app uses no path-based router.
export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), versionFile()],
  build: { outDir: 'dist', sourcemap: false },
  test: {
    // node by default so the pure rules/ledger/ai suites don't pay for jsdom;
    // the DOM suites opt in with an @vitest-environment docblock.
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.{js,jsx}']
  }
});
