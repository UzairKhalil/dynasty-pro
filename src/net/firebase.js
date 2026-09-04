// Firebase is the ONLY thing in this app that isn't served by GitHub Pages.
// It is loaded lazily: a build with no config never downloads the SDK and the
// app falls back to local-only play with an honest notice in the footer.
//
// The web config below is not a secret — Firebase web keys are public by
// design, and access is governed by the database rules in firebase.rules.json.

import { defaults } from './firebase.config.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const pick = (fromEnv, fallback) => (fromEnv && String(fromEnv).trim()) || fallback || '';

export const config = {
  apiKey:      pick(env.VITE_FIREBASE_API_KEY,      defaults.apiKey),
  authDomain:  pick(env.VITE_FIREBASE_AUTH_DOMAIN,  defaults.authDomain),
  databaseURL: pick(env.VITE_FIREBASE_DATABASE_URL, defaults.databaseURL),
  projectId:   pick(env.VITE_FIREBASE_PROJECT_ID,   defaults.projectId),
  appId:       pick(env.VITE_FIREBASE_APP_ID,       defaults.appId)
};

// databaseURL is the gate: without a Realtime Database there is nowhere for two
// devices to meet, so the app stays local-only and says so rather than hanging.
export const isConfigured = () => Boolean(config.apiKey && config.databaseURL);

let pending = null;

/**
 * Resolves to { db, api } with the database helpers attached, or null when the
 * build has no Firebase config or the SDK fails to load. Callers must handle
 * null — that is the normal offline path, not an error.
 */
export function connect() {
  if (!isConfigured()) return Promise.resolve(null);
  if (!pending) {
    pending = (async () => {
      try {
        const [{ initializeApp }, api] = await Promise.all([
          import('firebase/app'),
          import('firebase/database')
        ]);
        const app = initializeApp(config);
        return { db: api.getDatabase(app), api };
      } catch (err) {
        console.warn('[dynasty] Firebase unavailable, staying local:', err?.message || err);
        return null;
      }
    })();
  }
  return pending;
}

/** Fires cb(true|false) as the realtime connection comes and goes. */
export async function watchConnection(cb) {
  const fb = await connect();
  if (!fb) { cb(false); return () => {}; }
  const { db, api } = fb;
  return api.onValue(api.ref(db, '.info/connected'), (snap) => cb(snap.val() === true));
}
