import { describe, it, expect } from 'vitest';
import { chooseMove, LEVELS } from '../src/game/ai.js';
import { createGame, applyMove, findWin } from '../src/game/rules.js';
import { IDS } from '../src/data/players.js';

// Deterministic stand-in for Math.random so a failure is reproducible.
function seeded(seed = 1) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const board = (spec, size = 3) =>
  spec.split('').map((c) => (c === '.' ? null : c === 'x' ? 'uzair' : 'maryam'))
    .concat(new Array(size * size).fill(null)).slice(0, size * size);

function gameFrom(spec, { size = 3, turn = 0, mode = 'duel' } = {}) {
  const g = createGame({ mode, order: ['uzair', 'maryam'] });
  const cells = board(spec, size);
  return { ...g, cells, turn, moves: cells.map((v, i) => (v ? i : -1)).filter((i) => i >= 0) };
}

function playOut(level, rand) {
  let g = createGame({ mode: 'duel', order: ['uzair', 'maryam'] });
  while (!g.over) g = applyMove(g, chooseMove(g, level, rand));
  return g;
}

describe('levels', () => {
  it('offers three, with blunder rates that only go down', () => {
    const rates = Object.values(LEVELS).map((l) => l.blunder);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
    expect(LEVELS.ruthless.blunder).toBe(0);
  });
});

describe('tactics', () => {
  it('takes an immediate win when one is on offer', () => {
    // uzair holds 0 and 3 and finishes the left column at 6; maryam's two
    // squares are not on a shared line, so there is nothing to block.
    expect(chooseMove(gameFrom('x..x.o.o.'), 'ruthless', seeded())).toBe(6);
  });

  it('blocks an opponent about to win', () => {
    // maryam threatens the top row at 2; uzair's 3 and 7 cannot make a line,
    // so blocking is the only move that matters.
    expect(chooseMove(gameFrom('oo.x...x.'), 'ruthless', seeded())).toBe(2);
  });

  it('prefers its own win over blocking theirs', () => {
    // uzair finishes at 2, maryam would finish at 5. Taking the win must win
    // the tie-break against making the block.
    expect(chooseMove(gameFrom('xx.oo....'), 'ruthless', seeded())).toBe(2);
  });

  it('blocks a four-in-a-row threat on the 6x6 board', () => {
    const cells = new Array(36).fill(null);
    [0, 1, 2].forEach((i) => { cells[i] = 'maryam'; });
    cells[10] = 'uzair';
    const g = { ...createGame({ mode: 'free', order: ['uzair', 'maryam'] }), cells, turn: 0 };
    expect(chooseMove(g, 'ruthless', seeded())).toBe(3);
  });

  it('returns -1 when there is nothing to play', () => {
    const done = { ...createGame({ mode: 'duel', order: ['uzair', 'maryam'] }), over: true };
    expect(chooseMove(done, 'steady', seeded())).toBe(-1);
  });
});

describe('ruthless is unbeatable on 3x3', () => {
  it('always draws against itself', () => {
    for (let i = 0; i < 25; i++) {
      expect(playOut('ruthless', seeded(i + 1)).winner).toBeNull();
    }
  });

  it('never loses to a random player, over 60 games from both sides', () => {
    let losses = 0;
    for (let i = 0; i < 60; i++) {
      const rand = seeded(i + 100);
      const botFirst = i % 2 === 0;
      let g = createGame({ mode: 'duel', order: ['uzair', 'maryam'] });
      const bot = botFirst ? 'uzair' : 'maryam';
      while (!g.over) {
        const seat = g.order[g.turn];
        if (seat === bot) {
          g = applyMove(g, chooseMove(g, 'ruthless', rand));
        } else {
          const open = g.cells.reduce((a, v, k) => (v == null ? (a.push(k), a) : a), []);
          g = applyMove(g, open[Math.floor(rand() * open.length)]);
        }
      }
      if (g.winner && g.winner !== bot) losses++;
    }
    expect(losses).toBe(0);
  });
});

describe('strength ordering', () => {
  it('ruthless beats easy far more often than the reverse', () => {
    let strong = 0;
    let weak = 0;
    for (let i = 0; i < 60; i++) {
      const rand = seeded(i + 7);
      let g = createGame({ mode: 'duel', order: ['uzair', 'maryam'] });
      while (!g.over) {
        const level = g.order[g.turn] === 'uzair' ? 'ruthless' : 'easy';
        g = applyMove(g, chooseMove(g, level, rand));
      }
      if (g.winner === 'uzair') strong++;
      else if (g.winner === 'maryam') weak++;
    }
    expect(weak).toBe(0);
    expect(strong).toBeGreaterThan(20);
  });
});

describe('always legal', () => {
  it('only ever picks an empty square, across both boards', () => {
    for (const mode of ['duel', 'free']) {
      for (let i = 0; i < 30; i++) {
        const rand = seeded(i + 500);
        let g = createGame({ mode, order: IDS.slice(0, mode === 'duel' ? 2 : 4) });
        let guard = 0;
        while (!g.over && guard++ < 40) {
          const idx = chooseMove(g, 'steady', rand);
          expect(g.cells[idx]).toBeNull();
          expect(idx).toBeGreaterThanOrEqual(0);
          g = applyMove(g, idx);
        }
        expect(g.over).toBe(true);
      }
    }
  });

  it('produces a real win or a real draw, never a bogus line', () => {
    for (let i = 0; i < 40; i++) {
      const g = playOut('steady', seeded(i + 900));
      expect(g.over).toBe(true);
      if (g.winner) {
        expect(g.line.length).toBeGreaterThanOrEqual(g.need);
        expect(g.line.every((k) => g.cells[k] === g.winner)).toBe(true);
        expect(findWin(g.cells, g.size, g.need, g.line[0])).not.toBeNull();
      } else {
        expect(g.moves).toHaveLength(g.cells.length);
      }
    }
  });
});

describe('speed', () => {
  // The bot used to rescan every opponent for a one-move win inside its
  // candidate loop, which is always false by then (see chooseMove). Removing
  // that dead work took a mid-game 6x6 move from 1.16ms to 0.25ms. The bound
  // below is loose on purpose: it exists to catch a catastrophic regression,
  // not to police microseconds.
  it('picks a 6x6 move for four players well inside a turn delay', () => {
    let g = createGame({ mode: 'free', order: IDS.slice() });
    const rand = seeded(3);
    for (const i of [0, 7, 14, 21]) g = applyMove(g, i);

    const t0 = performance.now();
    for (let k = 0; k < 10; k++) chooseMove(g, 'ruthless', rand);
    const perMove = (performance.now() - t0) / 10;

    expect(perMove).toBeLessThan(120);
  });

  it('still finishes a full four-player 6x6 game promptly', () => {
    const t0 = performance.now();
    let g = createGame({ mode: 'free', order: IDS.slice() });
    const rand = seeded(11);
    while (!g.over) g = applyMove(g, chooseMove(g, 'ruthless', rand));
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(g.over).toBe(true);
  });
});
