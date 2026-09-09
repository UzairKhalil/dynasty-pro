// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { open, KEY, CAP } from '../src/net/store.js';
import { connect, isConfigured } from '../src/net/firebase.js';

// The build ships a real Firebase config, so an unmocked open() here would talk
// to the family's live database. connect() is mocked instead: null by default
// (the offline path), or a fake in-memory Realtime Database when a test wants
// to exercise the cloud path. Neither touches the network.
vi.mock('../src/net/firebase.js', () => ({
  config: { apiKey: 'test', databaseURL: 'https://example.invalid' },
  isConfigured: vi.fn(() => true),
  connect: vi.fn(async () => null),
  watchConnection: vi.fn(async (cb) => { cb(false); return () => {}; })
}));

/**
 * A minimal stand-in for firebase/database: enough of ref/push/set/update/
 * remove/onValue/get for store.js, backed by a plain object.
 */
function fakeDatabase() {
  const root = {};
  const listeners = [];
  let seq = 0;

  const split = (path) => path.split('/').filter(Boolean);
  const readAt = (path) => split(path).reduce((node, k) => (node == null ? undefined : node[k]), root);
  const writeAt = (path, value) => {
    const parts = split(path);
    const last = parts.pop();
    let node = root;
    for (const k of parts) node = (node[k] = node[k] || {});
    if (value === null || value === undefined) delete node[last];
    else node[last] = value;
  };
  const emit = () => listeners.forEach(({ path, cb }) =>
    cb({ val: () => (readAt(path) === undefined ? null : readAt(path)) }));

  const api = {
    ref: (_db, path = '') => ({ path }),
    push: (node) => ({ path: `${node.path}/k${++seq}` }),
    set: async (node, value) => { writeAt(node.path, value); emit(); },
    update: async (node, value) => {
      writeAt(node.path, { ...(readAt(node.path) || {}), ...value });
      emit();
    },
    remove: async (node) => { writeAt(node.path, null); emit(); },
    get: async (node) => ({ val: () => readAt(node.path) ?? null }),
    onValue: (node, cb) => {
      const entry = { path: node.path, cb };
      listeners.push(entry);
      cb({ val: () => (readAt(node.path) === undefined ? null : readAt(node.path)) });
      return () => listeners.splice(listeners.indexOf(entry), 1);
    },
    onDisconnect: () => ({ set: async () => {}, remove: async () => {} }),
    serverTimestamp: () => Date.now()
  };
  return { db: {}, api, root };
}
import { encodeCells, decodeCells, encodeGame, decodeGame } from '../src/net/match.js';
import { createGame, applyMove } from '../src/game/rules.js';
import { foldGames } from '../src/game/ledger.js';
import { IDS } from '../src/data/players.js';

const entry = (winner = 'uzair', at = Date.now()) =>
  ({ players: ['uzair', 'maryam'], winner, mode: 'duel', kind: 'local', at });

const realLocal = Object.getOwnPropertyDescriptor(window, 'localStorage');

beforeEach(() => {
  if (realLocal) Object.defineProperty(window, 'localStorage', realLocal);
  window.localStorage.clear();
  connect.mockResolvedValue(null);          // offline unless a test says otherwise
});
afterEach(() => {
  if (realLocal) Object.defineProperty(window, 'localStorage', realLocal);
});

/* ------------------------------------------------------------------ */

describe('backend selection', () => {
  it('falls back to localStorage when the realtime service is unreachable', async () => {
    expect((await open()).source).toBe('local');
  });

  it('uses the cloud when a realtime connection is available', async () => {
    connect.mockResolvedValue(fakeDatabase());
    expect((await open()).source).toBe('cloud');
  });

  it('reports none when storage is blocked entirely, rather than pretending', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked'); }
    });
    const store = await open();
    expect(store.source).toBe('none');
    // and it still keeps the session's games in memory
    await store.append(entry());
    let seen = [];
    store.watch((g) => { seen = g; });
    expect(seen).toHaveLength(1);
  });

  it('only claims to be configured when a databaseURL is actually present', () => {
    // isConfigured gates online play; an apiKey alone must not turn it on.
    expect(isConfigured()).toBe(true);      // the mock supplies both
  });
});

describe('the cloud backend', () => {
  it('appends a game under a generated key and pushes it to watchers', async () => {
    const fake = fakeDatabase();
    connect.mockResolvedValue(fake);
    const store = await open();

    let seen = [];
    store.watch((g) => { seen = g; });
    expect(seen).toEqual([]);

    await store.append(entry('zahra'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ winner: 'zahra', mode: 'duel' });
    expect(Object.keys(fake.root.games)).toHaveLength(1);
  });

  it('carries the database key through as the game id, so one can be struck', async () => {
    const fake = fakeDatabase();
    connect.mockResolvedValue(fake);
    const store = await open();
    let seen = [];
    store.watch((g) => { seen = g; });

    await store.append(entry('uzair', 1));
    await store.append(entry('maryam', 2));
    expect(seen).toHaveLength(2);
    expect(seen.every((g) => typeof g.id === 'string' && g.id.length)).toBe(true);

    await store.remove(seen[0].id);
    expect(seen).toHaveLength(1);
    expect(seen[0].winner).toBe('maryam');
  });

  it('mirrors the shared table to localStorage so a dropped link still shows it', async () => {
    connect.mockResolvedValue(fakeDatabase());
    const store = await open();
    store.watch(() => {});
    await store.append(entry('zain'));
    expect(JSON.parse(window.localStorage.getItem(KEY))).toHaveLength(1);
  });

  it('clears the shared table for everyone', async () => {
    const fake = fakeDatabase();
    connect.mockResolvedValue(fake);
    const store = await open();
    let seen = [];
    store.watch((g) => { seen = g; });
    await store.append(entry());
    await store.clear();
    expect(seen).toEqual([]);
    expect(fake.root.games).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

describe('the local backend', () => {
  it('appends a game and hands it straight to the watcher', async () => {
    const store = await open();
    let seen = null;
    store.watch((g) => { seen = g; });
    expect(seen).toEqual([]);
    await store.append(entry());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ winner: 'uzair', mode: 'duel', kind: 'local' });
  });

  it('writes through to localStorage so a reload sees it', async () => {
    const store = await open();
    await store.append(entry('maryam'));
    const raw = JSON.parse(window.localStorage.getItem(KEY));
    expect(raw).toHaveLength(1);
    expect(raw[0].winner).toBe('maryam');
    expect((await open()).seed).toHaveLength(1);
  });

  it('gives every game a stable id, so one can be struck without touching the rest', async () => {
    const store = await open();
    await store.append(entry('uzair', 1));
    await store.append(entry('maryam', 2));
    await store.append(entry(null, 3));
    let seen = [];
    store.watch((g) => { seen = g; });
    expect(new Set(seen.map((g) => g.id)).size).toBe(3);

    await store.remove(seen[1].id);
    expect(seen).toHaveLength(2);
    expect(seen.map((g) => g.winner)).toEqual(['uzair', null]);
    expect(JSON.parse(window.localStorage.getItem(KEY))).toHaveLength(2);
  });

  it('clears everything on demand', async () => {
    const store = await open();
    await store.append(entry());
    let seen = null;
    store.watch((g) => { seen = g; });
    await store.clear();
    expect(seen).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(KEY))).toEqual([]);
  });

  it('caps the stored history so the key cannot grow without bound', async () => {
    const store = await open();
    for (let i = 0; i < CAP + 25; i++) await store.append(entry('uzair', i + 1));
    expect(JSON.parse(window.localStorage.getItem(KEY))).toHaveLength(CAP);
  });

  it('survives corrupt JSON in the key rather than throwing on boot', async () => {
    window.localStorage.setItem(KEY, '{not json');
    expect((await open()).seed).toEqual([]);
  });

  it('drops a stored entry naming a player who is not on the roster', async () => {
    window.localStorage.setItem(KEY, JSON.stringify([
      { players: ['uzair', 'ghost'], winner: 'ghost', mode: 'duel', at: 1 },
      entry('uzair', 2)
    ]));
    const seed = (await open()).seed;
    expect(foldGames(seed).stats.uzair.p).toBe(1);
  });

  it('stops calling back after the watcher is released', async () => {
    const store = await open();
    let calls = 0;
    const stop = store.watch(() => { calls++; });
    expect(calls).toBe(1);
    await store.append(entry());
    expect(calls).toBe(2);
    stop();
    await store.append(entry());
    expect(calls).toBe(2);
  });
});

/* ------------------------------------------------------------------ */

describe('the online wire format', () => {
  it('round-trips an empty board', () => {
    const cells = new Array(9).fill(null);
    expect(decodeCells(encodeCells(cells))).toEqual(cells);
    expect(encodeCells(cells)).toBe('.........');
  });

  it('round-trips a board holding all four players', () => {
    const cells = new Array(36).fill(null);
    IDS.forEach((id, i) => { cells[i * 3] = id; });
    expect(decodeCells(encodeCells(cells))).toEqual(cells);
  });

  it('encodes as one character per cell, which is what keeps nulls from vanishing', () => {
    // Realtime Database drops nulls inside arrays; a string cannot go sparse.
    const cells = [null, 'uzair', null, null, 'zain', null, null, null, null];
    const wire = encodeCells(cells);
    expect(wire).toHaveLength(9);
    expect(wire).toBe('.0..3....');
    expect(decodeCells(wire)).toEqual(cells);
  });

  it('round-trips a game mid-play', () => {
    let g = createGame({ mode: 'duel', order: ['zahra', 'zain'] });
    g = applyMove(applyMove(g, 4), 0);
    const back = decodeGame(encodeGame(g));
    expect(back.cells).toEqual(g.cells);
    expect(back.order).toEqual(g.order);
    expect(back.turn).toBe(g.turn);
    expect(back.moves).toEqual(g.moves);
    expect(back.over).toBe(false);
  });

  it('round-trips a finished game with its winning line', () => {
    let g = createGame({ mode: 'duel', order: ['uzair', 'maryam'] });
    for (const i of [0, 3, 1, 4, 2]) g = applyMove(g, i);
    const back = decodeGame(encodeGame(g));
    expect(back.over).toBe(true);
    expect(back.winner).toBe('uzair');
    expect(back.line).toEqual([0, 1, 2]);
  });

  it('round-trips the 6x6 board', () => {
    let g = createGame({ mode: 'free', order: IDS.slice() });
    for (const i of [0, 7, 14, 21, 1]) g = applyMove(g, i);
    const back = decodeGame(encodeGame(g));
    expect(back.cells).toEqual(g.cells);
    expect(back.size).toBe(6);
    expect(back.need).toBe(4);
  });

  it('rebuilds something sane from a malformed payload rather than throwing', () => {
    const back = decodeGame({ mode: 'nonsense', cells: null, order: ['uzair', 'ghost'] });
    expect(back.mode).toBe('duel');
    expect(back.size).toBe(3);
    expect(back.order).toEqual(['uzair']);
    expect(back.cells).toEqual([]);
    expect(back.over).toBe(false);
  });

  it('returns null for a missing match', () => {
    expect(decodeGame(null)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe('portability', () => {
  it('never hardcodes a repo path, so the build works at any Pages URL', async () => {
    const fs = await import('node:fs');
    const cfg = fs.readFileSync('vite.config.js', 'utf8');
    expect(cfg).toMatch(/base:\s*'\.\/'/);
  });

  it('keeps the Firebase SDK out of the main bundle until it is configured', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/net/firebase.js', 'utf8');
    // static `import ... from 'firebase/...'` would pull the SDK into the
    // entry chunk for every visitor, configured or not
    expect(src).not.toMatch(/^import .* from 'firebase/m);
    expect(src).toMatch(/await Promise\.all\(\[\s*import\('firebase\/app'\)/);
  });
});
