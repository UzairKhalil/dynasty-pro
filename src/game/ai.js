import { findWin } from './rules.js';

export const LEVELS = {
  easy:     { label: 'Easy',     blunder: 0.45 },
  steady:   { label: 'Steady',   blunder: 0.12 },
  ruthless: { label: 'Ruthless', blunder: 0 }
};

const windowCache = {};

// Every straight run of `need` cells on the board, precomputed once per shape.
function windows(size, need) {
  const key = `${size}:${need}`;
  if (windowCache[key]) return windowCache[key];
  const out = [];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const end_r = r + dr * (need - 1);
        const end_c = c + dc * (need - 1);
        if (end_r < 0 || end_r >= size || end_c < 0 || end_c >= size) continue;
        const win = [];
        for (let k = 0; k < need; k++) win.push((r + dr * k) * size + (c + dc * k));
        out.push(win);
      }
    }
  }
  windowCache[key] = out;
  return out;
}

// A window is worth something only while exactly one player can still fill it.
// Value grows steeply with how full it already is, so three-in-a-row with room
// to finish outranks any number of scattered pairs.
const WEIGHT = [0, 1, 8, 60, 420, 3000, 20000];

function score(cells, size, need, me) {
  let mine = 0;
  const theirs = {};
  for (const win of windows(size, need)) {
    let owner = null;
    let count = 0;
    let blocked = false;
    for (const i of win) {
      const v = cells[i];
      if (!v) continue;
      if (owner && v !== owner) { blocked = true; break; }
      owner = v;
      count++;
    }
    if (blocked || !owner) continue;
    const value = WEIGHT[Math.min(count, WEIGHT.length - 1)];
    if (owner === me) mine += value;
    else theirs[owner] = (theirs[owner] || 0) + value;
  }
  const worst = Object.values(theirs).reduce((a, b) => Math.max(a, b), 0);
  return mine - worst * 1.05;
}

const empties = (cells) => cells.reduce((a, v, i) => (v == null ? (a.push(i), a) : a), []);

function immediateWin(cells, size, need, id) {
  for (const i of empties(cells)) {
    const next = cells.slice();
    next[i] = id;
    if (findWin(next, size, need, i)) return i;
  }
  return -1;
}

/* ---- perfect play on 3x3, where the tree is small enough to solve ---- */

function solve(cells, size, need, order, turn, me, depth, alpha, beta) {
  const open = empties(cells);
  if (!open.length) return { score: 0 };
  let best = null;
  for (const i of open) {
    const next = cells.slice();
    next[i] = order[turn];
    let value;
    if (findWin(next, size, need, i)) {
      value = order[turn] === me ? 100 - depth : depth - 100;
    } else {
      value = solve(next, size, need, order, (turn + 1) % order.length, me,
        depth + 1, alpha, beta).score;
    }
    if (order[turn] === me) {
      if (!best || value > best.score) best = { idx: i, score: value };
      alpha = Math.max(alpha, value);
    } else {
      if (!best || value < best.score) best = { idx: i, score: value };
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/**
 * Picks a move for whoever is on turn. `rand` is injectable so tests can drive
 * the bot deterministically.
 */
export function chooseMove(game, level = 'steady', rand = Math.random) {
  if (!game || game.over) return -1;
  const { cells, size, need, order, turn } = game;
  const me = order[turn];
  const open = empties(cells);
  if (!open.length) return -1;

  const blunder = LEVELS[level]?.blunder ?? 0;
  if (blunder && rand() < blunder) return open[Math.floor(rand() * open.length)];

  // Take the win, then stop the loss. Both dominate any positional score.
  const win = immediateWin(cells, size, need, me);
  if (win >= 0) return win;
  for (const other of order) {
    if (other === me) continue;
    const block = immediateWin(cells, size, need, other);
    if (block >= 0) return block;
  }

  if (size === 3 && order.length === 2 && level === 'ruthless') {
    const best = solve(cells, size, need, order, turn, me, 0, -Infinity, Infinity);
    if (best && best.idx != null) return best.idx;
  }

  // Nothing below re-checks for an opponent's one-move win, and it must not:
  // reaching here means the block scan above found none, and placing OUR mark
  // can only ever remove a cell from an opponent's winning line, never add one.
  // A per-candidate rescan is therefore always false. It also cost
  // empties x opponents x empties findWin calls to learn nothing — dropping it
  // took a mid-game 6x6 move from 1.16ms to 0.25ms. Neither is perceptible;
  // it was removed because it was dead, not because it was slow.
  let bestIdx = open[0];
  let bestScore = -Infinity;
  for (const i of open) {
    const next = cells.slice();
    next[i] = me;
    const value = score(next, size, need, me) + rand() * 0.5;  // tie-break, no bias
    if (value > bestScore) { bestScore = value; bestIdx = i; }
  }
  return bestIdx;
}
