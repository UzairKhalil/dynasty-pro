import { IDS } from '../data/players.js';

export const MODES = {
  duel:  { size: 3, need: 3, label: 'Duel · 3×3',        seats: 2 },
  free:  { size: 6, need: 4, label: 'Free-for-all · 6×6', seats: 4 }
};

// INVARIANT 4 — every shape is centred on (50,50), OPTICALLY not by bounding box.
// The triangle sits at y 16..74 because a triangle's visual weight is low; its
// bbox centre would read as sitting below centre. The diamond's centroid is
// already the centre, so it needs no correction. Don't "tidy" these numbers.
export const SHAPES = {
  x: ['M23,23 Q50,48 77,77', 'M77,23 Q50,52 23,77'],
  o: ['M52,20 C69,20 80,33 80,50 C80,67 67,80 50,80 C33,80 20,67 20,50 C20,33 32,20 48,20.5'],
  t: ['M50,16 L82,74 L18,74 L52,16'],
  d: ['M50,17 L83,50 L50,83 L17,50 L52,18']
};

// INVARIANT 3 — grid lines come from a seeded PRNG, never Math.random().
// With Math.random() the hand-drawn wobble is re-rolled on every render and
// the grid visibly twitches.
export function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const gridCache = {};

export function gridPaths(n) {
  if (gridCache[n]) return gridCache[n];
  const rand = rng(n * 977 + 13);
  const step = 100 / n;
  const out = [];
  const line = (x1, y1, x2, y2) => {
    const mx = (x1 + x2) / 2 + (rand() * 2 - 1) * 1.2;
    const my = (y1 + y2) / 2 + (rand() * 2 - 1) * 1.2;
    out.push(`M${x1},${y1} Q${mx.toFixed(2)},${my.toFixed(2)} ${x2},${y2}`);
  };
  for (let i = 1; i < n; i++) {
    const v = +(i * step).toFixed(2);
    line(v, 4, v, 96);
    line(4, v, 96, v);
  }
  gridCache[n] = out;
  return out;
}

// Scans the four directions outward from the placed index rather than sweeping
// the whole board. Returns the winning run sorted ascending, or null.
export function findWin(cells, size, need, idx) {
  const id = cells[idx];
  if (!id) return null;
  const r = Math.floor(idx / size);
  const c = idx % size;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [idx];
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1;
      let rr = r + dr * s;
      let cc = c + dc * s;
      while (rr >= 0 && rr < size && cc >= 0 && cc < size && cells[rr * size + cc] === id) {
        line.push(rr * size + cc);
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (line.length >= need) return line.sort((a, b) => a - b);
  }
  return null;
}

export function createGame({ mode, order, starterFlip = 0 }) {
  const { size, need } = MODES[mode];
  const seats = order.slice();
  if (mode === 'duel' && starterFlip % 2 === 1) seats.reverse();
  return {
    mode, size, need,
    order: seats,
    turn: 0,
    cells: new Array(size * size).fill(null),
    moves: [],
    over: false,
    winner: null,
    line: null
  };
}

// Pure reducer: returns the next game, or the same object when the move is
// illegal. Never mutates, so React state updates and the online sync agree.
export function applyMove(game, idx) {
  if (!game || game.over || game.cells[idx] != null) return game;
  const id = game.order[game.turn];
  const cells = game.cells.slice();
  cells[idx] = id;
  const moves = game.moves.concat(idx);
  const line = findWin(cells, game.size, game.need, idx);
  const full = moves.length === cells.length;
  return {
    ...game,
    cells, moves,
    over: !!line || full,
    winner: line ? id : null,
    line: line || null,
    turn: line || full ? game.turn : (game.turn + 1) % game.order.length
  };
}

export function undoMove(game) {
  if (!game || game.over || !game.moves.length) return game;
  const moves = game.moves.slice();
  const idx = moves.pop();
  const cells = game.cells.slice();
  cells[idx] = null;
  return {
    ...game,
    cells, moves,
    turn: (game.turn - 1 + game.order.length) % game.order.length
  };
}

// King of the hill across four: the winner holds the board, the loser goes to
// the back of the line, and the next player waiting steps in. On a draw both
// step off.
export function advanceQueue(queue, winner) {
  const [a, b, ...rest] = queue;
  if (!winner) return [...rest, a, b];
  const loser = winner === a ? b : a;
  return [winner, ...rest, loser];
}

export const emptyQueue = () => IDS.slice();
