/**
 * Firebase web config for the Dynasty board.
 *
 * These values are checked in on purpose. Firebase web config is public by
 * design — it ships inside the built bundle for every visitor either way, so
 * hiding it buys nothing. What actually constrains access is the rule set in
 * firebase.rules.json. Anything here can be overridden per-environment with
 * the matching VITE_FIREBASE_* variable (see .env.example).
 *
 * databaseURL is the one that decides whether online play turns on at all:
 * leave it empty and the app runs local-only and says so in its own footer,
 * rather than hanging on a connection that will never open.
 */
export const defaults = {
  apiKey: 'AIzaSyAIgRhmVWQG2X0jWzO4nqyOPjqgbMitgAw',
  authDomain: 'khalil-a67e5.firebaseapp.com',
  projectId: 'khalil-a67e5',
  appId: '1:789078571297:web:a602ade05512712b35a660',

  // Created 2026-09-09 in Singapore (asia-southeast1), chosen because the
  // players are in South Asia: ~100-200ms round trip versus ~400ms from
  // us-central1, which is the difference between a move landing instantly and
  // landing visibly late. A Realtime Database's region is permanent, so this
  // cannot be changed without creating a new database.
  databaseURL: 'https://khalil-a67e5-default-rtdb.asia-southeast1.firebasedatabase.app'
};
