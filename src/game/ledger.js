import { IDS, P, PAIRS, pairKey } from '../data/players.js';

export const LOG_LIMIT = 20;

export function blankLedger() {
  return {
    stats: Object.fromEntries(IDS.map((id) => [id, { p: 0, w: 0, d: 0, l: 0, streak: 0, best: 0 }])),
    h2h: Object.fromEntries(PAIRS.map((pr) => [pr.join('|'), { a: 0, b: 0, d: 0 }])),
    log: []
  };
}

// Repairs anything malformed rather than trusting what came out of storage —
// a saved ledger can be from an older roster, a half-written sync, or hand-edited.
export function heal(raw) {
  const l = blankLedger();
  if (!raw || typeof raw !== 'object') return l;
  for (const id of IDS) {
    const s = raw.stats?.[id];
    if (s) l.stats[id] = {
      p: +s.p || 0, w: +s.w || 0, d: +s.d || 0, l: +s.l || 0,
      streak: +s.streak || 0, best: +s.best || 0
    };
  }
  for (const pr of PAIRS) {
    const k = pr.join('|');
    const h = raw.h2h?.[k];
    if (h) l.h2h[k] = { a: +h.a || 0, b: +h.b || 0, d: +h.d || 0 };
  }
  if (Array.isArray(raw.log)) {
    l.log = raw.log
      .filter((g) => g && Array.isArray(g.players) && g.players.every((id) => P[id]))
      .map((g) => ({
        players: g.players.slice(),
        winner: P[g.winner] ? g.winner : null,
        mode: g.mode === 'free' ? 'free' : 'duel',
        kind: ['online', 'local', 'solo'].includes(g.kind) ? g.kind : 'local',
        at: +g.at || 0
      }))
      .slice(0, LOG_LIMIT);
  }
  return l;
}

export const points = (l, id) => l.stats[id].w * 3 + l.stats[id].d;

// Returns a NEW ledger. Kept pure so the same call can be replayed against the
// cloud copy without double-counting local state.
export function record(ledger, { players, winner, mode, kind = 'local', at = Date.now() }) {
  const l = {
    stats: Object.fromEntries(Object.entries(ledger.stats).map(([k, v]) => [k, { ...v }])),
    h2h: Object.fromEntries(Object.entries(ledger.h2h).map(([k, v]) => [k, { ...v }])),
    log: ledger.log.slice()
  };

  for (const id of players) {
    const s = l.stats[id];
    s.p++;
    if (!winner) { s.d++; s.streak = 0; }
    else if (id === winner) { s.w++; s.streak++; s.best = Math.max(s.best, s.streak); }
    else { s.l++; s.streak = 0; }
  }

  if (players.length === 2) {
    const key = pairKey(players[0], players[1]);
    if (key) {
      const h = l.h2h[key];
      if (!winner) h.d++;
      else if (winner === key.split('|')[0]) h.a++;
      else h.b++;
    }
  }

  l.log.unshift({ players: players.slice(), winner: winner || null, mode, kind, at });
  l.log = l.log.slice(0, LOG_LIMIT);
  return l;
}

/**
 * The ledger is a pure fold over the game list, never a running total that gets
 * mutated in place. That is what makes the shared cloud copy conflict-free:
 * two devices appending games at once can't clobber each other's arithmetic,
 * because nobody ever writes a total.
 */
export function foldGames(games) {
  const ordered = (games || [])
    .filter((g) => g && Array.isArray(g.players) && g.players.length && g.players.every((id) => P[id]))
    .slice()
    .sort((a, b) => (+a.at || 0) - (+b.at || 0));
  const l = ordered.reduce((acc, g) => record(acc, g), blankLedger());
  l.log = ordered.slice(-LOG_LIMIT).reverse();
  return l;
}

export function normaliseGame(g) {
  return {
    players: g.players.slice(),
    winner: P[g.winner] ? g.winner : null,
    mode: g.mode === 'free' ? 'free' : 'duel',
    kind: ['online', 'local', 'solo'].includes(g.kind) ? g.kind : 'local',
    at: +g.at || Date.now()
  };
}

export function standings(ledger) {
  return IDS.map((id) => ({ id, ...ledger.stats[id], points: points(ledger, id) }))
    .sort((a, b) =>
      b.points - a.points || b.w - a.w || a.l - b.l || P[a.id].name.localeCompare(P[b.id].name));
}

export const hasPlayed = (ledger) => IDS.some((id) => ledger.stats[id].p > 0);
