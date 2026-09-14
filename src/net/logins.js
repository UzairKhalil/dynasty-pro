import { connect } from './firebase.js';
import { describeDevice, deviceId } from './device.js';

// The sign-in history the admin page shows. One entry per sign-in and per
// sign-out, with what the browser reports about the device.
//
// "Admin only" is a UI rule, like everything else in this app: the history is
// stored without authentication, so anyone who can read the database can read
// it. It holds device details, not codes — the code maps one-to-one to the
// player, who is already recorded, and the codes ship in the bundle anyway.

export const PATH = 'logins';
export const CAP = 300;
export const LOCAL_KEY = 'dynasty:logins:v1';

// Realtime Database rejects `undefined` anywhere in a write, and several
// navigator fields are undefined on one browser or another. Drop them.
export function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, v]) => v !== undefined && !(typeof v === 'number' && !Number.isFinite(v)))
      .map(([k, v]) => [k, clean(v)]));
  }
  return value;
}

export function normaliseLogin(id, raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.player !== 'string') return null;
  return {
    id,
    player: raw.player,
    kind: raw.kind === 'out' ? 'out' : 'in',
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    at: +raw.at || 0,
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
    device: raw.device && typeof raw.device === 'object' ? raw.device : {}
  };
}

const newestFirst = (a, b) => b.at - a.at;

function readLocal() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.map((r, i) => normaliseLogin(r.id || `l${i}`, r)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function writeLocal(list) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, CAP)));
  } catch { /* full or blocked: history is best-effort */ }
}

const localListeners = new Set();
const emitLocal = () => {
  const list = readLocal().sort(newestFirst);
  localListeners.forEach((cb) => cb(list));
};

/**
 * Records a sign-in or sign-out. Best-effort by design: a failure here must
 * never block anyone from playing, so every path swallows its own errors.
 */
export async function recordLogin(player, kind = 'in', reason = null) {
  let device = {};
  try { device = await describeDevice(); } catch { /* keep going without it */ }
  const entry = clean({ player, kind, reason, at: Date.now(), deviceId: deviceId(), device });

  const fb = await connect().catch(() => null);
  if (fb) {
    const { db, api } = fb;
    try {
      await api.set(api.push(api.ref(db, PATH)), entry);
      prune(db, api);
      return entry;
    } catch (err) {
      console.warn('[dynasty] could not record sign-in:', err?.message || err);
    }
  }
  const list = [{ ...entry, id: `l${entry.at}-${Math.random().toString(36).slice(2, 6)}` },
    ...readLocal()].sort(newestFirst);
  writeLocal(list);
  emitLocal();
  return entry;
}

// Keep the newest CAP entries. Runs after a write, never before one.
async function prune(db, api) {
  try {
    const snap = await api.get(api.ref(db, PATH));
    const all = Object.entries(snap.val() || {})
      .map(([id, v]) => ({ id, at: +(v && v.at) || 0 }))
      .sort(newestFirst);
    if (all.length <= CAP) return;
    const drop = Object.fromEntries(all.slice(CAP).map(({ id }) => [id, null]));
    await api.update(api.ref(db, PATH), drop);
  } catch { /* pruning is housekeeping; skip it on failure */ }
}

/**
 * Subscribes to the history, newest first. Returns { source, stop }.
 *
 * A denied or failed read calls onError and falls back to this device's copy.
 * Without that, database rules that do not yet cover /logins leave the admin
 * page on "Loading..." forever, because the listener is cancelled silently.
 */
export async function watchLogins(cb, onError) {
  const fb = await connect().catch(() => null);
  if (fb) {
    const { db, api } = fb;
    const stop = api.onValue(api.ref(db, PATH), (snap) => {
      const list = Object.entries(snap.val() || {})
        .map(([id, v]) => normaliseLogin(id, v))
        .filter(Boolean)
        .sort(newestFirst);
      cb(list);
    }, (err) => {
      if (onError) onError(err);
      cb(readLocal().sort(newestFirst));
    });
    return { source: 'cloud', stop };
  }
  localListeners.add(cb);
  cb(readLocal().sort(newestFirst));
  return { source: 'local', stop: () => localListeners.delete(cb) };
}

export async function clearLogins() {
  const fb = await connect().catch(() => null);
  if (fb) {
    const { db, api } = fb;
    try {
      await api.remove(api.ref(db, PATH));
    } catch (err) {
      console.warn('[dynasty] could not clear shared history:', err?.message || err);
    }
  }
  writeLocal([]);
  emitLocal();
}
