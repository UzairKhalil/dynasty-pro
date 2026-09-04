import { connect } from './firebase.js';
import { IDS } from '../data/players.js';

const PATH = 'presence';
const STALE_MS = 70_000;

const offline = () => Object.fromEntries(IDS.map((id) => [id, { online: false, at: 0, busy: null }]));

/**
 * Claims a seat as online and releases it on disconnect. onDisconnect() is why
 * this uses Firebase rather than a plain poll: the server marks you offline
 * when the socket drops, so a closed tab doesn't leave a ghost online forever.
 * Returns a cleanup function.
 */
export async function claim(playerId, { onState } = {}) {
  const fb = await connect();
  if (!fb) return () => {};
  const { db, api } = fb;
  const me = api.ref(db, `${PATH}/${playerId}`);
  const conn = api.ref(db, '.info/connected');

  const stop = api.onValue(conn, async (snap) => {
    if (snap.val() !== true) return;
    try {
      await api.onDisconnect(me).set({ online: false, at: api.serverTimestamp(), busy: null });
      await api.set(me, { online: true, at: api.serverTimestamp(), busy: null });
    } catch (err) {
      console.warn('[dynasty] presence claim failed:', err?.message || err);
    }
  });

  // A heartbeat so a laptop that slept without closing the socket still ages out.
  const beat = setInterval(() => {
    api.update(me, { at: api.serverTimestamp() }).catch(() => {});
  }, 30_000);

  return () => {
    clearInterval(beat);
    stop();
    api.set(me, { online: false, at: api.serverTimestamp(), busy: null }).catch(() => {});
  };
}

/** Marks which match a player is in, so the lobby can grey them out. */
export async function setBusy(playerId, matchId) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  api.update(api.ref(db, `${PATH}/${playerId}`), { busy: matchId || null }).catch(() => {});
}

/**
 * Admin escape hatch: forces every seat offline. Useful when a crashed tab
 * leaves a ghost that the staleness window hasn't aged out yet.
 */
export async function clearAll() {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.set(api.ref(db, PATH), Object.fromEntries(
    IDS.map((id) => [id, { online: false, at: 0, busy: null }])
  ));
}

/** Subscribes to everyone's presence. cb receives a full id -> state map. */
export async function watchAll(cb) {
  const fb = await connect();
  if (!fb) { cb(offline()); return () => {}; }
  const { db, api } = fb;
  return api.onValue(api.ref(db, PATH), (snap) => {
    const raw = snap.val() || {};
    const now = Date.now();
    cb(Object.fromEntries(IDS.map((id) => {
      const v = raw[id] || {};
      const at = +v.at || 0;
      // Trust `online:false` immediately; distrust a stale `online:true`.
      const fresh = at > 0 && now - at < STALE_MS;
      return [id, { online: v.online === true && fresh, at, busy: v.busy || null }];
    })));
  });
}

export { offline as offlineState };
