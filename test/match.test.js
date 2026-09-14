import { describe, it, expect, beforeEach, vi } from 'vitest';

// Never reach the family's live database: connect() hands back a fake.
vi.mock('../src/net/firebase.js', () => ({
  config: {},
  isConfigured: vi.fn(() => true),
  connect: vi.fn(async () => null),
  watchConnection: vi.fn(async (cb) => { cb(false); return () => {}; })
}));

import { connect } from '../src/net/firebase.js';
import {
  invite, respond, cancel, agreeRematch, withdrawRematch, watchInvite, findResumable,
  decodeGame, encodeGame
} from '../src/net/match.js';
import { createGame, applyMove } from '../src/game/rules.js';

/** A small Realtime Database: paths, push keys, server timestamps, transactions. */
function fakeDatabase() {
  const root = {};
  const listeners = [];
  const disconnects = [];
  let seq = 0;
  const split = (p) => p.split('/').filter(Boolean);
  const readAt = (p) => split(p).reduce((n, k) => (n == null ? undefined : n[k]), root);
  const resolve = (v) => {
    if (v && typeof v === 'object' && v['.sv'] === 'timestamp') return Date.now();
    if (Array.isArray(v)) return v.map(resolve);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined)
        .map(([k, x]) => [k, resolve(x)]));
    }
    return v;
  };
  const writeAt = (p, v) => {
    const parts = split(p);
    const last = parts.pop();
    let n = root;
    for (const k of parts) n = (n[k] = n[k] || {});
    if (v === null || v === undefined) delete n[last];
    else n[last] = v;
  };
  const valueOf = (p) => {
    if (p === '.info/serverTimeOffset') return 0;
    const v = readAt(p);
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  };
  const related = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  const emit = (changed) => listeners.slice().forEach(({ path, cb }) => {
    if (path.startsWith('.info') || !related(path, changed)) return;
    cb({ val: () => valueOf(path) });
  });
  const snap = (p) => ({ val: () => valueOf(p) });

  const api = {
    ref: (_db, path = '') => ({ path, key: split(path).pop() }),
    push: (node) => { const key = `m${++seq}`; return { path: `${node.path}/${key}`, key }; },
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    set: async (node, v) => { writeAt(node.path, resolve(v)); emit(node.path); },
    update: async (node, v) => {
      for (const [k, x] of Object.entries(v)) writeAt(`${node.path}/${k}`, x === null ? null : resolve(x));
      emit(node.path);
    },
    remove: async (node) => { writeAt(node.path, null); emit(node.path); },
    get: async (node) => snap(node.path),
    runTransaction: async (node, fn) => {
      const next = fn(valueOf(node.path));
      if (next === undefined) return { committed: false, snapshot: snap(node.path) };
      writeAt(node.path, next === null ? null : resolve(next));
      emit(node.path);
      return { committed: true, snapshot: snap(node.path) };
    },
    onValue: (node, cb) => {
      const entry = { path: node.path, cb };
      listeners.push(entry);
      cb(snap(node.path));
      return () => { const i = listeners.indexOf(entry); if (i >= 0) listeners.splice(i, 1); };
    },
    onDisconnect: (node) => {
      disconnects.push(node.path);
      return { set: async () => {}, update: async () => {}, remove: async () => {}, cancel: async () => {} };
    }
  };
  return { db: {}, api, root, disconnects, put: (p, v) => { writeAt(p, v); emit(p); } };
}

let fake;
beforeEach(() => {
  fake = fakeDatabase();
  connect.mockResolvedValue(fake);
});

const match = (id) => fake.root.matches[id];

/** Plays a finished game into a match, as the clients would. */
function finish(id) {
  let g = decodeGame(match(id).game);
  const plan = g.order[0] === match(id).host ? [0, 3, 1, 4, 2] : [0, 3, 1, 4, 2];
  for (const i of plan) g = applyMove(g, i);
  fake.put(`matches/${id}/game`, encodeGame(g));
  return g;
}

/* ------------------------------------------------------------------ */

describe('challenging', () => {
  it('opens a pending match and drops an invite in the guest’s inbox', async () => {
    const id = await invite('uzair', 'maryam');
    expect(match(id)).toMatchObject({ host: 'uzair', guest: 'maryam', status: 'pending', round: 0 });
    expect(fake.root.invites.maryam).toMatchObject({ matchId: id, from: 'uzair' });
  });

  it('arms no disconnect handler on the invite — the old one deleted later invites', async () => {
    await invite('uzair', 'maryam');
    expect(fake.disconnects.filter((p) => p.startsWith('invites/'))).toEqual([]);
  });
});

describe('accepting', () => {
  it('moves a pending match to active and clears the invite', async () => {
    const id = await invite('uzair', 'maryam');
    expect(await respond(id, 'maryam', true)).toBe(true);
    expect(match(id).status).toBe('active');
    expect(fake.root.invites?.maryam).toBeUndefined();
  });

  it('refuses a withdrawn challenge instead of reviving it', async () => {
    const id = await invite('uzair', 'maryam');
    await cancel(id, 'maryam', 'uzair');
    expect(await respond(id, 'maryam', true)).toBe(false);
    expect(match(id).status).toBe('cancelled');
  });

  it('refuses a match that no longer exists, without creating half of one', async () => {
    fake.put('invites/maryam', { matchId: 'gone', from: 'uzair', mode: 'duel', at: 1 });
    expect(await respond('gone', 'maryam', true)).toBe(false);
    expect(fake.root.matches?.gone).toBeUndefined();
    expect(fake.root.invites?.maryam).toBeUndefined();   // the dead invite is cleared
  });

  it('only the invited player can accept', async () => {
    const id = await invite('uzair', 'maryam');
    expect(await respond(id, 'zahra', true)).toBe(false);
    expect(match(id).status).toBe('pending');
  });

  it('declining closes the match', async () => {
    const id = await invite('uzair', 'maryam');
    expect(await respond(id, 'maryam', false)).toBe(true);
    expect(match(id).status).toBe('declined');
  });

  it('clearing one invite never deletes a newer one from someone else', async () => {
    const first = await invite('uzair', 'zahra');
    const second = await invite('maryam', 'zahra');       // replaces zahra's inbox
    await respond(first, 'zahra', false);
    expect(fake.root.invites.zahra.matchId).toBe(second);
  });
});

describe('withdrawing', () => {
  it('cancels a pending challenge', async () => {
    const id = await invite('uzair', 'maryam');
    await cancel(id, 'maryam', 'uzair');
    expect(match(id).status).toBe('cancelled');
  });

  it('closes a just-accepted one as left, so the guest is told', async () => {
    const id = await invite('uzair', 'maryam');
    await respond(id, 'maryam', true);
    await cancel(id, 'maryam', 'uzair');
    expect(match(id)).toMatchObject({ status: 'done', leftBy: 'uzair' });
  });

  it('never touches a finished match', async () => {
    const id = await invite('uzair', 'maryam');
    fake.put(`matches/${id}/status`, 'done');
    await cancel(id, 'maryam', 'uzair');
    expect(match(id).status).toBe('done');
  });
});

describe('play again', () => {
  async function playedOut() {
    const id = await invite('uzair', 'zain');
    await respond(id, 'zain', true);
    finish(id);
    return id;
  }

  it('does nothing before the game is over', async () => {
    const id = await invite('uzair', 'zain');
    await respond(id, 'zain', true);
    expect(await agreeRematch(id, 'uzair')).toBe(false);
    expect(match(id).rematch).toBeUndefined();
  });

  it('records the first agreement under the real player', async () => {
    const id = await playedOut();
    await agreeRematch(id, 'zain');
    expect(match(id).rematch).toEqual({ zain: true });
    expect(match(id).round).toBe(0);
  });

  // THE bug: agreements landed under "null", or under a sibling who had used
  // the same phone, so both-agreed could never be true.
  it('refuses to record anyone who is not in the match', async () => {
    const id = await playedOut();
    expect(await agreeRematch(id, 'zahra')).toBe(false);
    expect(await agreeRematch(id, null)).toBe(false);
    expect(await agreeRematch(id, 'null')).toBe(false);
    expect(match(id).rematch).toBeUndefined();
  });

  it('the second agreement starts the round by itself — no host needed', async () => {
    const id = await playedOut();
    await agreeRematch(id, 'uzair');      // the host agrees, then locks the phone
    await agreeRematch(id, 'zain');       // the guest's tap alone must start it
    expect(match(id).round).toBe(1);
    expect(match(id).rematch).toBeUndefined();
    const g = decodeGame(match(id).game);
    expect(g.over).toBe(false);
    expect(g.moves).toEqual([]);
  });

  it('ignores stray agreements from earlier bugs when counting', async () => {
    const id = await playedOut();
    fake.put(`matches/${id}/rematch`, { zahra: true, null: true });   // left by the stale-closure bug
    await agreeRematch(id, 'uzair');
    expect(match(id).round).toBe(0);                                  // zain has not agreed
    expect(match(id).rematch).toEqual({ uzair: true });               // and the junk is dropped
  });

  it('alternates who starts: host, then guest, then host', async () => {
    const id = await playedOut();
    expect(decodeGame(match(id).game).order[0]).toBe('uzair');        // round 0 was the host's
    await agreeRematch(id, 'uzair');
    await agreeRematch(id, 'zain');
    expect(decodeGame(match(id).game).order[0]).toBe('zain');          // round 1: the guest
    finish(id);
    await agreeRematch(id, 'zain');
    await agreeRematch(id, 'uzair');
    expect(match(id).round).toBe(2);
    expect(decodeGame(match(id).game).order[0]).toBe('uzair');         // round 2: the host again
  });

  it('agreeing twice is harmless', async () => {
    const id = await playedOut();
    await agreeRematch(id, 'uzair');
    await agreeRematch(id, 'uzair');
    expect(match(id).round).toBe(0);
    expect(match(id).rematch).toEqual({ uzair: true });
  });

  it('can be withdrawn', async () => {
    const id = await playedOut();
    await agreeRematch(id, 'uzair');
    await withdrawRematch(id, 'uzair');
    expect(match(id).rematch?.uzair).toBeUndefined();
  });

  it('is refused once someone has left', async () => {
    const id = await playedOut();
    fake.put(`matches/${id}/status`, 'done');
    expect(await agreeRematch(id, 'uzair')).toBe(false);
  });
});

describe('the guest’s inbox', () => {
  it('shows a live invite', async () => {
    const id = await invite('uzair', 'maryam');
    let seen = 'unset';
    const stop = await watchInvite('maryam', (v) => { seen = v; });
    expect(seen).toMatchObject({ matchId: id, from: 'uzair' });
    stop();
  });

  it('hides it the moment the challenge is withdrawn', async () => {
    const id = await invite('uzair', 'maryam');
    let seen = null;
    const stop = await watchInvite('maryam', (v) => { seen = v; });
    expect(seen).toBeTruthy();
    fake.put(`matches/${id}/status`, 'cancelled');
    expect(seen).toBeNull();
    stop();
  });

  it('never offers an invite whose match is gone, and clears it', async () => {
    fake.put('invites/maryam', { matchId: 'gone', from: 'uzair', mode: 'duel', at: 1 });
    let seen = 'unset';
    const stop = await watchInvite('maryam', (v) => { seen = v; });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toBeNull();
    expect(fake.root.invites?.maryam).toBeUndefined();
    stop();
  });
});

describe('picking a game back up after a reload', () => {
  it('finds the active game this player was in', async () => {
    const id = await invite('uzair', 'maryam');
    await respond(id, 'maryam', true);
    expect(await findResumable('maryam')).toEqual({ matchId: id, guest: 'maryam' });
    expect(await findResumable('uzair')).toEqual({ matchId: id, guest: 'maryam' });
  });

  it('puts a host back to waiting on a challenge still out', async () => {
    const id = await invite('uzair', 'maryam');
    expect(await findResumable('uzair')).toEqual({ matchId: id, guest: 'maryam' });
    expect(await findResumable('maryam')).toBeNull();          // the guest has the invite instead
  });

  it('ignores finished, abandoned, other people’s and stale games', async () => {
    const done = await invite('uzair', 'maryam');
    fake.put(`matches/${done}/status`, 'done');
    const left = await invite('uzair', 'zahra');
    await respond(left, 'zahra', true);
    fake.put(`matches/${left}/leftBy`, 'zahra');
    const old = await invite('uzair', 'zain');
    await respond(old, 'zain', true);
    fake.put(`matches/${old}/updatedAt`, Date.now() - 60 * 60 * 1000);
    expect(await findResumable('uzair')).toBeNull();
    expect(await findResumable('maryam')).toBeNull();
  });
});
