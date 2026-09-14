import { connect } from './firebase.js';
import { IDS } from '../data/players.js';
import { MODES, createGame } from '../game/rules.js';

// Realtime Database drops nulls inside arrays, which would turn a half-played
// board into a sparse object. Encoding the board as one char per cell keeps it
// a dense, tiny, order-preserving string instead.
export const encodeCells = (cells) =>
  cells.map((v) => (v == null ? '.' : String(IDS.indexOf(v)))).join('');

export const decodeCells = (str) =>
  String(str || '').split('').map((c) => (c === '.' ? null : IDS[+c] ?? null));

export function encodeGame(game) {
  return {
    mode: game.mode, size: game.size, need: game.need,
    order: game.order.slice(),
    turn: game.turn,
    cells: encodeCells(game.cells),
    moves: game.moves.slice(),
    over: !!game.over,
    winner: game.winner || null,
    line: game.line ? game.line.slice() : null
  };
}

/**
 * Should an incoming snapshot replace the board we are showing?
 *
 * Both arguments are `{ round, moves }`. The rule that matters:
 *
 *   a NEW round always wins, however few moves it has.
 *
 * Comparing move counts alone is the bug this exists to prevent. A fresh board
 * has 0 moves; a just-finished one has 5. "Fewer moves means stale" therefore
 * rejected the next game outright, and whichever player had not pressed the
 * button was left staring at the previous result while the other played on.
 *
 * Within the SAME round, fewer moves really does mean stale — that is our own
 * optimistic move not having round-tripped yet, and adopting would visibly
 * un-play it.
 */
export function adopt(local, remote) {
  if (!local) return true;
  if (remote.round !== local.round) return remote.round > local.round;
  return remote.moves >= local.moves;
}

/** Who has asked to play again. Cleared when the next round starts. */
export function decodeRematch(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    IDS.filter((id) => raw[id] === true).map((id) => [id, true])
  );
}

export function decodeGame(raw) {
  if (!raw) return null;
  const mode = MODES[raw.mode] ? raw.mode : 'duel';
  return {
    mode,
    size: +raw.size || MODES[mode].size,
    need: +raw.need || MODES[mode].need,
    order: Array.isArray(raw.order) ? raw.order.filter((id) => IDS.includes(id)) : [],
    turn: +raw.turn || 0,
    cells: decodeCells(raw.cells),
    moves: Array.isArray(raw.moves) ? raw.moves.map(Number) : [],
    over: raw.over === true,
    winner: raw.winner || null,
    line: Array.isArray(raw.line) ? raw.line.map(Number) : null
  };
}

const MATCH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Nothing else ever deletes a match, so /matches would grow without bound on a
 * free-tier database. Sweeping on invite keeps it O(games played today) and
 * costs one read on an action that is already a write.
 */
async function sweep(db, api) {
  try {
    const snap = await api.get(api.ref(db, 'matches'));
    const all = snap.val() || {};
    const cutoff = Date.now() - MATCH_TTL_MS;
    const stale = Object.entries(all)
      .filter(([, m]) => Number(m?.updatedAt || m?.createdAt || 0) < cutoff)
      .map(([id]) => id);
    await Promise.all(stale.map((id) => api.remove(api.ref(db, `matches/${id}`))));
  } catch {
    // A failed sweep must never stop a game from starting.
  }
}

const RESUME_ACTIVE_MS = 15 * 60 * 1000;
const RESUME_PENDING_MS = 10 * 60 * 1000;

/** "Now" on the server's clock. A device clock can be minutes out. */
function serverNow(api, db) {
  return new Promise((resolve) => {
    let stop = null;
    let done = false;
    stop = api.onValue(api.ref(db, '.info/serverTimeOffset'), (snap) => {
      if (done) return;
      done = true;
      resolve(Date.now() + (Number(snap.val()) || 0));
      Promise.resolve().then(() => { if (stop) stop(); });
    });
  });
}

/** Removes the guest's invite, but only if it is still the one for this match. */
async function clearInvite(db, api, guest, matchId) {
  try {
    await api.runTransaction(api.ref(db, `invites/${guest}`), (cur) => {
      if (!cur) return cur;
      return cur.matchId === matchId ? null : undefined;
    });
  } catch { /* housekeeping: a stale invite is also caught where it is shown */ }
}

/**
 * Host creates a pending match and drops an invite in the guest's inbox.
 *
 * There is deliberately no onDisconnect on the invite. There used to be one,
 * registered on the HOST's connection and never cancelled: hours later, any
 * blip on the host's phone deleted whatever invite that guest held -- including
 * a brand-new one from someone else. Stale invites are now caught on the
 * guest's side instead, by watching the match itself (watchInvite).
 */
export async function invite(host, guest, mode = 'duel') {
  const fb = await connect();
  if (!fb) return null;
  const { db, api } = fb;
  sweep(db, api);
  const node = api.push(api.ref(db, 'matches'));
  const id = node.key;
  const game = createGame({ mode, order: [host, guest] });
  await api.set(node, {
    id, host, guest, mode, status: 'pending',
    round: 0,
    game: encodeGame(game),
    createdAt: api.serverTimestamp(),
    updatedAt: api.serverTimestamp()
  });
  await api.set(api.ref(db, `invites/${guest}`), { matchId: id, from: host, mode, at: api.serverTimestamp() });
  return id;
}

/**
 * Accept or decline, as a transaction that only succeeds on a match still
 * pending for this guest. The plain update() it replaces marked a cancelled or
 * abandoned match "active" -- putting the guest on a board nobody on the other
 * side was watching -- and on a match that no longer existed it threw after
 * the banner had gone, so Accept looked like it did nothing.
 *
 * Resolves true only if this call is what moved the match on.
 */
export async function respond(matchId, guest, accept) {
  const fb = await connect();
  if (!fb) return false;
  const { db, api } = fb;
  let ok = false;
  try {
    const res = await api.runTransaction(api.ref(db, `matches/${matchId}`), (m) => {
      if (!m) return m;
      if (m.status !== 'pending' || m.guest !== guest) return undefined;
      return { ...m, status: accept ? 'active' : 'declined', updatedAt: api.serverTimestamp() };
    });
    const after = res && res.snapshot ? res.snapshot.val() : null;
    ok = Boolean(res && res.committed && after && after.status === (accept ? 'active' : 'declined'));
  } catch (err) {
    console.warn('[dynasty] could not answer the challenge:', err?.message || err);
  }
  await clearInvite(db, api, guest, matchId);
  return ok;
}

/**
 * Withdraws a challenge. A pending match is cancelled; one the guest has just
 * accepted is closed as "left by" whoever withdrew, so the guest is told
 * rather than left facing a board with nobody opposite. A finished match is
 * never touched.
 */
export async function cancel(matchId, guest, by = null) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await clearInvite(db, api, guest, matchId);
  try {
    await api.runTransaction(api.ref(db, `matches/${matchId}`), (m) => {
      if (!m) return m;
      if (m.status === 'pending') return { ...m, status: 'cancelled', updatedAt: api.serverTimestamp() };
      if (m.status === 'active' && by) {
        return { ...m, status: 'done', leftBy: by, updatedAt: api.serverTimestamp() };
      }
      return undefined;
    });
  } catch (err) {
    console.warn('[dynasty] could not withdraw the challenge:', err?.message || err);
  }
}

/**
 * "Play again". Records this player's agreement and, if that completes it,
 * starts the next round -- all in one transaction, run by whichever player
 * agrees SECOND. The round used to be started only by the host, from an
 * effect, so whenever the host's phone was locked or in the background the
 * other player's Accept did nothing until the host came back.
 *
 * The player is checked against the match. The caller's id used to come from
 * a stale closure -- whoever was signed in when the page first loaded -- so
 * agreements landed under "null", or under a sibling who had used the same
 * phone, and could never complete.
 *
 * Starters alternate from a fixed base of [host, guest]: round 0 the host,
 * round 1 the guest, round 2 the host again. Deriving the order from the last
 * round's order flipped it twice and let the same player start every round
 * after the first.
 */
export async function agreeRematch(matchId, playerId) {
  const fb = await connect();
  if (!fb) return false;
  const { db, api } = fb;
  try {
    const res = await api.runTransaction(api.ref(db, `matches/${matchId}`), (m) => {
      if (!m) return m;
      if (m.status !== 'active' || !m.game || m.game.over !== true) return undefined;
      if (playerId !== m.host && playerId !== m.guest) return undefined;
      const had = m.rematch || {};
      const rematch = {};
      if (had[m.host] === true) rematch[m.host] = true;
      if (had[m.guest] === true) rematch[m.guest] = true;
      rematch[playerId] = true;
      if (!(rematch[m.host] && rematch[m.guest])) return { ...m, rematch };
      const round = (Number(m.round) || 0) + 1;
      const mode = MODES[m.mode] ? m.mode : (m.game && MODES[m.game.mode] ? m.game.mode : 'duel');
      const next = createGame({ mode, order: [m.host, m.guest], starterFlip: round });
      const { rematch: _drop, ...rest } = m;
      return { ...rest, round, game: encodeGame(next), updatedAt: api.serverTimestamp() };
    });
    return Boolean(res && res.committed);
  } catch (err) {
    console.warn('[dynasty] could not agree to a rematch:', err?.message || err);
    return false;
  }
}

export async function withdrawRematch(matchId, playerId) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.remove(api.ref(db, `matches/${matchId}/rematch/${playerId}`));
}

/** Pushes the authoritative game state. Only the player on turn should call this. */
export async function pushGame(matchId, game, extra = {}) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.update(api.ref(db, `matches/${matchId}`), {
    game: encodeGame(game), updatedAt: api.serverTimestamp(), ...extra
  });
}

export async function leave(matchId, playerId) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.update(api.ref(db, `matches/${matchId}`), {
    status: 'done', leftBy: playerId, updatedAt: api.serverTimestamp()
  });
}

export async function watchMatch(matchId, cb) {
  const fb = await connect();
  if (!fb) { cb(null); return () => {}; }
  const { db, api } = fb;
  return api.onValue(api.ref(db, `matches/${matchId}`), (snap) => {
    const raw = snap.val();
    cb(raw ? {
      ...raw,
      game: decodeGame(raw.game),
      round: +raw.round || 0,
      rematch: decodeRematch(raw.rematch)
    } : null);
  });
}

/**
 * The guest's inbox. An invite is only passed on while its match is still
 * pending for this player -- and the match itself is watched, so the banner
 * goes the moment the challenge stops being acceptable (withdrawn, taken,
 * abandoned), not only when the invite record changes. A dead invite is
 * cleared rather than shown with an Accept that cannot work.
 */
export async function watchInvite(playerId, cb) {
  const fb = await connect();
  if (!fb) { cb(null); return () => {}; }
  const { db, api } = fb;
  let seq = 0;
  let stopMatch = null;
  const stopInvite = api.onValue(api.ref(db, `invites/${playerId}`), (snap) => {
    const inv = snap.val();
    const mine = ++seq;
    if (stopMatch) { stopMatch(); stopMatch = null; }
    if (!inv || !inv.matchId) { cb(null); return; }
    stopMatch = api.onValue(api.ref(db, `matches/${inv.matchId}`), (ms) => {
      if (mine !== seq) return;
      const m = ms.val();
      const live = Boolean(m && m.status === 'pending' && m.guest === playerId && m.host === inv.from);
      if (live) {
        cb(inv);
      } else {
        cb(null);
        clearInvite(db, api, playerId, inv.matchId);
      }
    });
  });
  return () => {
    seq += 1;
    if (stopMatch) stopMatch();
    stopInvite();
  };
}

/**
 * After a reload or a sign-in, finds the online game this player was in, so
 * refreshing the page no longer abandons it -- and a host who reloads while a
 * challenge is out goes back to waiting for the answer, instead of the guest
 * accepting into a board nobody opposite is watching.
 *
 * Resolves { matchId, guest } -- the shape of `outgoing` -- or null.
 */
export async function findResumable(playerId) {
  const fb = await connect();
  if (!fb) return null;
  const { db, api } = fb;
  try {
    const [snap, now] = await Promise.all([api.get(api.ref(db, 'matches')), serverNow(api, db)]);
    const all = Object.entries(snap.val() || {}).map(([id, m]) => ({ ...m, id }));
    const fresh = (m, ms) => now - (Number(m.updatedAt || m.createdAt) || 0) < ms;
    const pick = all
      .filter((m) => (m.host === playerId || m.guest === playerId) && !m.leftBy)
      .filter((m) => (m.status === 'active' && fresh(m, RESUME_ACTIVE_MS)) ||
        (m.status === 'pending' && m.host === playerId && fresh(m, RESUME_PENDING_MS)))
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
    return pick ? { matchId: pick.id, guest: pick.guest } : null;
  } catch {
    return null;
  }
}
