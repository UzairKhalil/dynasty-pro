import { describe, it, expect } from 'vitest';
import {
  blankLedger, heal, foldGames, record, points, standings, hasPlayed, LOG_LIMIT
} from '../src/game/ledger.js';
import { IDS, PAIRS } from '../src/data/players.js';

const game = (players, winner, extra = {}) =>
  ({ players, winner, mode: players.length > 2 ? 'free' : 'duel', kind: 'local', at: 1, ...extra });

describe('blankLedger', () => {
  it('seats all four players and all six pairings', () => {
    const l = blankLedger();
    expect(Object.keys(l.stats).sort()).toEqual(IDS.slice().sort());
    expect(Object.keys(l.h2h)).toHaveLength(PAIRS.length);
    expect(l.log).toEqual([]);
    expect(hasPlayed(l)).toBe(false);
  });
});

describe('foldGames', () => {
  it('counts a duel win as 3 points and a loss as none', () => {
    const l = foldGames([game(['uzair', 'maryam'], 'uzair')]);
    expect(points(l, 'uzair')).toBe(3);
    expect(points(l, 'maryam')).toBe(0);
    expect(l.stats.uzair).toMatchObject({ p: 1, w: 1, d: 0, l: 0 });
    expect(l.stats.maryam).toMatchObject({ p: 1, w: 0, d: 0, l: 1 });
  });

  it('counts a draw as a point each', () => {
    const l = foldGames([game(['uzair', 'maryam'], null)]);
    expect(points(l, 'uzair')).toBe(1);
    expect(points(l, 'maryam')).toBe(1);
  });

  it('keeps played = W + D + L for everyone, over many games', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const games = Array.from({ length: 400 }, () => {
      const four = rnd() < 0.3;
      const players = four ? IDS.slice() : [IDS[Math.floor(rnd() * 4)], IDS[Math.floor(rnd() * 4)]];
      if (!four && players[0] === players[1]) players[1] = IDS[(IDS.indexOf(players[0]) + 1) % 4];
      const winner = rnd() < 0.18 ? null : players[Math.floor(rnd() * players.length)];
      return game(players, winner);
    });
    const l = foldGames(games);
    for (const id of IDS) {
      const s = l.stats[id];
      expect(s.p).toBe(s.w + s.d + s.l);
    }
    const totalSeats = games.reduce((a, g) => a + g.players.length, 0);
    expect(IDS.reduce((a, id) => a + l.stats[id].p, 0)).toBe(totalSeats);
  });

  it('is order independent — it sorts by timestamp before folding', () => {
    const games = [
      game(['uzair', 'maryam'], 'uzair', { at: 3 }),
      game(['uzair', 'maryam'], 'maryam', { at: 1 }),
      game(['uzair', 'maryam'], 'uzair', { at: 2 })
    ];
    const a = foldGames(games);
    const b = foldGames(games.slice().reverse());
    expect(a.stats).toEqual(b.stats);
    expect(a.h2h).toEqual(b.h2h);
  });

  it('is idempotent — folding the same list twice gives the same table', () => {
    const games = [game(['zahra', 'zain'], 'zahra'), game(['zahra', 'zain'], null)];
    expect(foldGames(games)).toEqual(foldGames(games));
  });

  it('tracks the current streak and the best run', () => {
    const l = foldGames([
      game(['uzair', 'maryam'], 'uzair', { at: 1 }),
      game(['uzair', 'maryam'], 'uzair', { at: 2 }),
      game(['uzair', 'maryam'], 'uzair', { at: 3 }),
      game(['uzair', 'maryam'], 'maryam', { at: 4 }),
      game(['uzair', 'maryam'], 'uzair', { at: 5 })
    ]);
    expect(l.stats.uzair.best).toBe(3);
    expect(l.stats.uzair.streak).toBe(1);
    expect(l.stats.maryam.streak).toBe(0);
  });

  it('records head-to-head for duels only, never for free-for-all', () => {
    const l = foldGames([
      game(['uzair', 'maryam'], 'uzair'),
      game(IDS.slice(), 'uzair')
    ]);
    const h = l.h2h[PAIRS.find((p) => p.includes('uzair') && p.includes('maryam')).join('|')];
    expect(h.a + h.b + h.d).toBe(1);
    expect(l.stats.uzair.w).toBe(2);
  });

  it('puts head-to-head wins on the correct side of the pairing', () => {
    const [a, b] = PAIRS[0];
    expect(foldGames([game([a, b], a)]).h2h[`${a}|${b}`]).toMatchObject({ a: 1, b: 0, d: 0 });
    expect(foldGames([game([a, b], b)]).h2h[`${a}|${b}`]).toMatchObject({ a: 0, b: 1, d: 0 });
    expect(foldGames([game([a, b], null)]).h2h[`${a}|${b}`]).toMatchObject({ a: 0, b: 0, d: 1 });
  });

  it('shows the newest game first and caps the log', () => {
    const games = Array.from({ length: LOG_LIMIT + 15 }, (_, i) =>
      game(['uzair', 'maryam'], i % 2 ? 'uzair' : 'maryam', { at: i + 1 }));
    const l = foldGames(games);
    expect(l.log).toHaveLength(LOG_LIMIT);
    expect(l.log[0].at).toBe(games.length);
    expect(l.log[0].at).toBeGreaterThan(l.log[1].at);
    // capping the LOG must not cap the ARITHMETIC
    expect(l.stats.uzair.p).toBe(games.length);
  });

  it('ignores games naming a player who is not on the roster', () => {
    const l = foldGames([game(['uzair', 'ghost'], 'ghost'), game(['uzair', 'maryam'], 'uzair')]);
    expect(l.stats.uzair.p).toBe(1);
  });
});

describe('record', () => {
  it('never mutates the ledger it is handed', () => {
    const before = blankLedger();
    const snapshot = JSON.stringify(before);
    record(before, game(['uzair', 'maryam'], 'uzair'));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('heal', () => {
  it('returns a blank ledger for junk input', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      expect(heal(junk)).toEqual(blankLedger());
    }
  });

  it('coerces non-numeric totals to zero rather than propagating NaN', () => {
    const l = heal({ stats: { uzair: { p: 'x', w: null, d: undefined, l: NaN } } });
    expect(l.stats.uzair).toMatchObject({ p: 0, w: 0, d: 0, l: 0 });
    expect(Number.isFinite(points(l, 'uzair'))).toBe(true);
  });

  it('drops log entries naming unknown players', () => {
    const l = heal({ log: [{ players: ['uzair', 'nobody'], winner: 'uzair' }] });
    expect(l.log).toEqual([]);
  });

  it('fills in missing pairings a smaller roster would have left out', () => {
    expect(Object.keys(heal({ h2h: { 'uzair|maryam': { a: 2, b: 1, d: 0 } } }).h2h))
      .toHaveLength(PAIRS.length);
  });
});

describe('standings', () => {
  it('orders by points, then wins, then fewest losses', () => {
    const l = foldGames([
      game(['zahra', 'zain'], 'zahra', { at: 1 }),
      game(['zahra', 'zain'], 'zahra', { at: 2 }),
      game(['uzair', 'maryam'], 'uzair', { at: 3 })
    ]);
    const table = standings(l);
    expect(table[0].id).toBe('zahra');
    expect(table[0].points).toBe(6);
    expect(table[1].id).toBe('uzair');
  });

  it('always lists all four, even before anyone has played', () => {
    expect(standings(blankLedger())).toHaveLength(4);
  });
});
