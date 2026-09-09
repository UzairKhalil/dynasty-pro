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

/** Host creates a pending match and drops an invite in the guest's inbox. */
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
  // Don't leave a ringing invite forever if the host wanders off.
  api.onDisconnect(api.ref(db, `invites/${guest}`)).remove();
  return id;
}

export async function respond(matchId, guest, accept) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.update(api.ref(db, `matches/${matchId}`), {
    status: accept ? 'active' : 'declined',
    updatedAt: api.serverTimestamp()
  });
  await api.remove(api.ref(db, `invites/${guest}`));
}

export async function cancel(matchId, guest) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.remove(api.ref(db, `invites/${guest}`));
  await api.update(api.ref(db, `matches/${matchId}`), { status: 'cancelled' });
}

/**
 * Says "I want to play again". The next round only starts once BOTH players
 * have asked — otherwise one player restarts the board out from under the
 * other, who is still looking at the result.
 */
export async function askRematch(matchId, playerId) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.update(api.ref(db, `matches/${matchId}/rematch`), { [playerId]: true });
}

export async function withdrawRematch(matchId, playerId) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.remove(api.ref(db, `matches/${matchId}/rematch/${playerId}`));
}

/**
 * Starts the next round. Only the host calls this, so both clients cannot
 * create two different boards at the same moment. `round` increments, which is
 * what lets the other client tell a NEW game from a stale echo of an old one.
 */
export async function startRound(matchId, game, round) {
  const fb = await connect();
  if (!fb) return;
  const { db, api } = fb;
  await api.update(api.ref(db, `matches/${matchId}`), {
    game: encodeGame(game),
    round,
    rematch: null,
    updatedAt: api.serverTimestamp()
  });
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

export async function watchInvite(playerId, cb) {
  const fb = await connect();
  if (!fb) { cb(null); return () => {}; }
  const { db, api } = fb;
  return api.onValue(api.ref(db, `invites/${playerId}`), (snap) => cb(snap.val() || null));
}
