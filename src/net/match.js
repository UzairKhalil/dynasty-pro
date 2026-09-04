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
    cb(raw ? { ...raw, game: decodeGame(raw.game) } : null);
  });
}

export async function watchInvite(playerId, cb) {
  const fb = await connect();
  if (!fb) { cb(null); return () => {}; }
  const { db, api } = fb;
  return api.onValue(api.ref(db, `invites/${playerId}`), (snap) => cb(snap.val() || null));
}
