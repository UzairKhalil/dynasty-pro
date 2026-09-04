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

  // ---------------------------------------------------------------------
  // REQUIRED FOR ONLINE PLAY — still empty.
  //
  // The config Firebase hands you only includes databaseURL once a Realtime
  // Database actually exists. Create one at
  //   console.firebase.google.com -> Build -> Realtime Database -> Create
  // then paste its URL here. It looks like one of:
  //   https://khalil-a67e5-default-rtdb.firebaseio.com              (us-central1)
  //   https://khalil-a67e5-default-rtdb.<region>.firebasedatabase.app
  //
  // Don't guess the region — copy the URL the console shows you. A wrong URL
  // is worse than an empty one: the app would think online play is available
  // and then fail to connect.
  // ---------------------------------------------------------------------
  databaseURL: ''
};
