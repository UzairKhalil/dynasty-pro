import { connect } from './firebase.js';
import { IDS } from '../data/players.js';

// Who is at the board.
//
// Three rules keep this symmetric -- so that if Maryam can see Uzair online,
// Uzair can see Maryam too:
//
//  1. The heartbeat re-asserts `online: true`, not just the timestamp. A seat
//     can be marked offline behind its back -- the same player's OTHER tab or
//     device closing fires its onDisconnect for the shared record, and the
//     admin can clear marks -- and a heartbeat that only touched `at` never
//     undid that. The player looked fine on their own screen (you always see
//     yourself) and "away" on everyone else's, indefinitely.
//  2. Freshness is judged on the SERVER's clock. `at` is a server timestamp;
//     comparing it with the viewer's Date.now() meant a laptop running a minute
//     fast saw every phone as stale while the phones saw the laptop as online.
//     Realtime Database publishes each client's offset at .info/serverTimeOffset.
//  3. Staleness is re-checked on a timer, not only when someone writes, so two
//     viewers converge on the same answer instead of each holding whatever
//     they last computed.

const PATH = 'presence';
export const BEAT_MS = 20_000;
export const STALE_MS = 90_000;
export const TICK_MS = 10_000;

const offline = () => Object.fromEntries(IDS.map((id) => [id, { online: false, at: 0, busy: null }]));

/** Pure: is this record live at `serverNow` (a server-clock time in ms)? */
export function isOnline(record, serverNow, stale = STALE_MS) {
  if (!record || record.online !== true) return false;
  const at = Number(record.at) || 0;
  return at > 0 && serverNow - at < stale;
}

/**
 * Claims a seat as online and keeps it that way while this page is open.
 * onDisconnect() marks it offline when the socket drops, so a closed tab does
 * not leave a ghost. Returns a cleanup function.
 */
export async function claim(playerId) {
  const fb = await connect();
  if (!fb) return () => {};
  const { db, api } = fb;
  const me = api.ref(db, `${PATH}/${playerId}`);
  // update(), not set(): a reconnect must not wipe `busy` mid-match.
  const up = () => api.update(me, { online: true, at: api.serverTimestamp() });

  const stop = api.onValue(api.ref(db, '.info/connected'), async (snap) => {
    if (snap.val() !== true) return;
    try {
      await api.onDisconnect(me).update({ online: false, at: api.serverTimestamp(), busy: null });
      await up();
    } catch (err) {
      console.warn('[dynasty] presence claim failed:', err?.message || err);
    }
  });

  const beat = setInterval(() => { up().catch(() => {}); }, BEAT_MS);

  // Coming back to the tab, or back onto the network: say so at once rather
  // than up to a heartbeat later.
  const wake = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    up().catch(() => {});
  };
  const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (hasDom) {
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
  }

  return () => {
    clearInterval(beat);
    if (hasDom) {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    }
    stop();
    api.update(me, { online: false, at: api.serverTimestamp(), busy: null }).catch(() => {});
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
 * Admin escape hatch: marks every seat offline. Anyone actually at the board
 * re-asserts within one heartbeat, so only genuine ghosts stay gone.
 *
 * Written per player through one multi-path update. A set() on /presence as a
 * whole was denied by the rules -- they grant writes at /presence/$player,
 * never at the collection -- so this button used to silently do nothing.
 */
export async function clearAll() {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.update(api.ref(db, PATH), Object.fromEntries(
    IDS.map((id) => [id, { online: false, at: 0 }])
  ));
}

/** Subscribes to everyone's presence. cb receives a full id -> state map. */
export async function watchAll(cb) {
  const fb = await connect();
  if (!fb) { cb(offline()); return () => {}; }
  const { db, api } = fb;

  let offset = 0;
  let raw = {};
  let last = '';
  const emit = () => {
    const serverNow = Date.now() + offset;
    const state = Object.fromEntries(IDS.map((id) => {
      const v = raw[id] || {};
      return [id, { online: isOnline(v, serverNow), at: Number(v.at) || 0, busy: v.busy || null }];
    }));
    // Only tell React when someone's status actually changed, not every tick.
    const key = JSON.stringify(IDS.map((id) => [state[id].online, state[id].busy]));
    if (key === last) return;
    last = key;
    cb(state);
  };

  const stopOffset = api.onValue(api.ref(db, '.info/serverTimeOffset'), (snap) => {
    offset = Number(snap.val()) || 0;
    emit();
  });
  const stopData = api.onValue(api.ref(db, PATH), (snap) => {
    raw = snap.val() || {};
    emit();
  });
  const tick = setInterval(emit, TICK_MS);

  return () => {
    clearInterval(tick);
    stopOffset();
    stopData();
  };
}

export { offline as offlineState };
