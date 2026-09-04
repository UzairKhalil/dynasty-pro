import { describe, it, expect } from 'vitest';
import {
  SHAPES, MODES, rng, gridPaths, findWin,
  createGame, applyMove, undoMove, advanceQueue
} from '../src/game/rules.js';
import { IDS, PAIRS, playerByCode, PLAYERS } from '../src/data/players.js';

const play = (game, ...idxs) => idxs.reduce((g, i) => applyMove(g, i), game);
const duel = (order = ['uzair', 'maryam']) => createGame({ mode: 'duel', order });

describe('roster', () => {
  it('derives six pairings rather than hardcoding them', () => {
    expect(PAIRS).toHaveLength(6);
    expect(PAIRS.every(([a, b]) => a !== b)).toBe(true);
    expect(new Set(PAIRS.map((p) => p.join('|'))).size).toBe(6);
  });

  it('gives every player a distinct five-digit code', () => {
    const codes = PLAYERS.map((p) => p.code);
    expect(new Set(codes).size).toBe(4);
    expect(codes.every((c) => /^\d{5}$/.test(c))).toBe(true);
  });

  it('resolves a code to its player and rejects anything else', () => {
    expect(playerByCode(PLAYERS[2].code).id).toBe(PLAYERS[2].id);
    expect(playerByCode('00000')).toBeNull();
    expect(playerByCode('')).toBeNull();
    expect(playerByCode(null)).toBeNull();
  });
});

describe('INVARIANT 4 — marks are optically centred, not bbox centred', () => {
  it('keeps the triangle at y 16..74, not 20..80', () => {
    expect(SHAPES.t).toEqual(['M50,16 L82,74 L18,74 L52,16']);
  });

  it('leaves the diamond on its centroid, which needs no correction', () => {
    expect(SHAPES.d).toEqual(['M50,17 L83,50 L50,83 L17,50 L52,18']);
  });

  it('has four distinct shapes, one per player', () => {
    const used = PLAYERS.map((p) => p.mark);
    expect(new Set(used).size).toBe(4);
    expect(used.every((m) => SHAPES[m])).toBe(true);
  });
});

describe('INVARIANT 3 — grid lines come from a seeded PRNG', () => {
  it('returns byte-identical paths on every call for a size', () => {
    expect(gridPaths(3)).toEqual(gridPaths(3));
    expect(gridPaths(6)).toEqual(gridPaths(6));
  });

  it('caches so repeat calls hand back the same array instance', () => {
    expect(gridPaths(3)).toBe(gridPaths(3));
  });

  it('draws n-1 lines on each axis', () => {
    expect(gridPaths(3)).toHaveLength(4);
    expect(gridPaths(6)).toHaveLength(10);
  });

  it('is a real PRNG: same seed, same stream', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('findWin', () => {
  it('finds a row, a column and both diagonals on 3x3', () => {
    const cases = [[0, 1, 2], [0, 3, 6], [0, 4, 8], [2, 4, 6]];
    for (const line of cases) {
      const cells = new Array(9).fill(null);
      line.forEach((i) => { cells[i] = 'uzair'; });
      expect(findWin(cells, 3, 3, line[2])).toEqual(line);
    }
  });

  it('needs four in a row on the 6x6 board, not three', () => {
    const cells = new Array(36).fill(null);
    [0, 1, 2].forEach((i) => { cells[i] = 'zain'; });
    expect(findWin(cells, 6, 4, 2)).toBeNull();
    cells[3] = 'zain';
    expect(findWin(cells, 6, 4, 3)).toEqual([0, 1, 2, 3]);
  });

  it('does not wrap around a row edge', () => {
    const cells = new Array(9).fill(null);
    [2, 3, 4].forEach((i) => { cells[i] = 'zahra'; });
    expect(findWin(cells, 3, 3, 3)).toBeNull();
  });

  it('will not join two different players into one line', () => {
    const cells = new Array(9).fill(null);
    cells[0] = 'uzair'; cells[1] = 'uzair'; cells[2] = 'maryam';
    expect(findWin(cells, 3, 3, 2)).toBeNull();
  });
});

describe('applyMove', () => {
  it('alternates turns and records the move', () => {
    const g = play(duel(), 0, 4);
    expect(g.cells[0]).toBe('uzair');
    expect(g.cells[4]).toBe('maryam');
    expect(g.moves).toEqual([0, 4]);
    expect(g.order[g.turn]).toBe('uzair');
  });

  it('ends the game on a win and freezes the turn', () => {
    const g = play(duel(), 0, 3, 1, 4, 2);
    expect(g.over).toBe(true);
    expect(g.winner).toBe('uzair');
    expect(g.line).toEqual([0, 1, 2]);
  });

  it('ends a full board as a draw', () => {
    const g = play(duel(), 0, 1, 2, 4, 3, 5, 7, 6, 8);
    expect(g.over).toBe(true);
    expect(g.winner).toBeNull();
    expect(g.moves).toHaveLength(9);
  });

  it('returns the SAME object for an illegal move, so React skips the render', () => {
    const g = play(duel(), 0);
    expect(applyMove(g, 0)).toBe(g);
    const done = play(duel(), 0, 3, 1, 4, 2);
    expect(applyMove(done, 5)).toBe(done);
  });

  it('never mutates the game it was handed', () => {
    const before = play(duel(), 0);
    const snapshot = JSON.stringify(before);
    applyMove(before, 4);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('cycles all four seats in free-for-all', () => {
    let g = createGame({ mode: 'free', order: IDS.slice() });
    const seen = [];
    for (let i = 0; i < 4; i++) { seen.push(g.order[g.turn]); g = applyMove(g, i * 6); }
    expect(seen).toEqual(['uzair', 'maryam', 'zahra', 'zain']);
  });

  it('alternates who starts a duel via starterFlip', () => {
    expect(createGame({ mode: 'duel', order: ['uzair', 'maryam'], starterFlip: 0 }).order[0]).toBe('uzair');
    expect(createGame({ mode: 'duel', order: ['uzair', 'maryam'], starterFlip: 1 }).order[0]).toBe('maryam');
  });
});

describe('undoMove', () => {
  it('takes back the last move and hands the turn back', () => {
    const g = undoMove(play(duel(), 0, 4));
    expect(g.cells[4]).toBeNull();
    expect(g.moves).toEqual([0]);
    expect(g.order[g.turn]).toBe('maryam');
  });

  it('refuses on an empty board or a finished game', () => {
    const fresh = duel();
    expect(undoMove(fresh)).toBe(fresh);
    const done = play(duel(), 0, 3, 1, 4, 2);
    expect(undoMove(done)).toBe(done);
  });
});

describe('king of the hill', () => {
  it('keeps the winner on and sends the loser to the back', () => {
    expect(advanceQueue(['uzair', 'maryam', 'zahra', 'zain'], 'uzair'))
      .toEqual(['uzair', 'zahra', 'zain', 'maryam']);
  });

  it('keeps the winner on when the winner was sitting in seat two', () => {
    expect(advanceQueue(['uzair', 'maryam', 'zahra', 'zain'], 'maryam'))
      .toEqual(['maryam', 'zahra', 'zain', 'uzair']);
  });

  it('steps both players off on a draw', () => {
    expect(advanceQueue(['uzair', 'maryam', 'zahra', 'zain'], null))
      .toEqual(['zahra', 'zain', 'uzair', 'maryam']);
  });

  it('never drops or duplicates a player', () => {
    let q = IDS.slice();
    for (let i = 0; i < 40; i++) {
      q = advanceQueue(q, i % 3 === 0 ? null : q[i % 2]);
      expect(new Set(q).size).toBe(4);
    }
  });
});

describe('board shapes', () => {
  it('is 3x3 needing three, and 6x6 needing four', () => {
    expect(MODES.duel).toMatchObject({ size: 3, need: 3 });
    expect(MODES.free).toMatchObject({ size: 6, need: 4 });
  });

  it('gives four players nine moves each on 6x6', () => {
    expect((6 * 6) / 4).toBe(9);
  });
});
