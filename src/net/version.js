/* global __BUILD_ID__ */

// Which build this page is running. Set at build time by vite.config.js.
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * True when the site has been redeployed since this page loaded.
 *
 * Phones keep a tab open for days and resume the JavaScript they first loaded,
 * so a fix to presence or rematches never reached them: an old client and a
 * new one then disagreed about who was online and whether a rematch had been
 * agreed. The query string gets past the CDN's ten-minute cache.
 */
export async function isNewBuildAvailable(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return false;
  try {
    const res = await fetchImpl(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res || !res.ok) return false;
    const data = await res.json();
    const build = data && data.build;
    return typeof build === 'string' && build.length > 0 && build !== BUILD_ID;
  } catch {
    return false;
  }
}
