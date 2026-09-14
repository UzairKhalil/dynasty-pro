// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Never reach the family's live database: connect() hands back a fake.
vi.mock('../src/net/firebase.js', () => ({
  config: {},
  isConfigured: vi.fn(() => true),
  connect: vi.fn(async () => null),
  watchConnection: vi.fn(async (cb) => { cb(false); return () => {}; })
}));

import { connect } from '../src/net/firebase.js';
import {
  isOnline, claim, setBusy, clearAll, watchAll, BEAT_MS, STALE_MS, TICK_MS
} from '../src/net/presence.js';

/**
 * A fake Realtime Database with just enough of the real one's behaviour:
 * server timestamps resolved on the SERVER's clock, .info/connected and
 * .info/serverTimeOffset, and onDisconnect handlers that only run when the
 * test says that client's socket dropped.
 */
function fakeDatabase({ serverClock = () => Date.now(), offset = 0 } = {}) {
  const root = {};
  const listeners = [];
  const pending = [];                         // onDisconnect handlers, in order
  const info = { connected: true, offset };
  const calls = { set: [], update: [] };

  const split = (p) => p.split('/').filter(Boolean);
  const readAt = (p) => split(p).reduce((n, k) => (n == null ? undefined : n[k]), root);
  const resolve = (v) => {
    if (v && typeof v === 'object' && v['.sv'] === 'timestamp') return serverClock();
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
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
  const merge = (p, obj) => {
    for (const [k, v] of Object.entries(obj)) {
      const child = `${p}/${k}`;
      if (v === null) writeAt(child, null);
      else writeAt(child, resolve(v));
    }
  };
  const valueOf = (p) => {
    if (p === '.info/connected') return info.connected;
    if (p === '.info/serverTimeOffset') return info.offset;
    const v = readAt(p);
    return v === undefined ? null : v;
  };
  // Data writes notify only data listeners on a related path; .info listeners
  // fire only when the connection or the clock offset changes, as in the real
  // SDK. Notifying .info/connected on every write made claim()'s handler
  // re-run on its own heartbeat, looping until the worker ran out of memory.
  const isInfo = (p) => p.startsWith('.info');
  const related = (a, b) => a === b || a === '' || b === '' ||
    a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  const emit = (changed) => listeners.slice().forEach(({ path, cb }) => {
    if (isInfo(path) || !related(path, changed)) return;
    cb({ val: () => valueOf(path) });
  });
  const emitInfo = (which) => listeners.slice().forEach(({ path, cb }) => {
    if (path === which) cb({ val: () => valueOf(path) });
  });

  const api = {
    ref: (_db, path = '') => ({ path }),
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    set: async (node, value) => { calls.set.push(node.path); writeAt(node.path, resolve(value)); emit(node.path); },
    update: async (node, value) => { calls.update.push(node.path); merge(node.path, value); emit(node.path); },
    remove: async (node) => { writeAt(node.path, null); emit(node.path); },
    get: async (node) => ({ val: () => valueOf(node.path) }),
    onValue: (node, cb) => {
      const entry = { path: node.path, cb };
      listeners.push(entry);
      cb({ val: () => valueOf(node.path) });
      return () => { const i = listeners.indexOf(entry); if (i >= 0) listeners.splice(i, 1); };
    },
    onDisconnect: (node) => ({
      update: async (value) => { pending.push({ path: node.path, value }); },
      set: async (value) => { pending.push({ path: node.path, value, replace: true }); },
      remove: async () => { pending.push({ path: node.path, value: null, replace: true }); }
    })
  };

  return {
    db: {},
    api,
    root,
    calls,
    /** The server notices client number `i` has gone and runs its handler. */
    drop(i) {
      const h = pending[i];
      if (!h) throw new Error(`no onDisconnect handler #${i}`);
      if (h.replace) writeAt(h.path, h.value === null ? null : resolve(h.value));
      else merge(h.path, h.value);
      emit(h.path);
    },
    setConnected(v) { info.connected = v; emitInfo('.info/connected'); },
    setOffset(v) { info.offset = v; emitInfo('.info/serverTimeOffset'); },
    put(path, value) { writeAt(path, value); emit(path); }
  };
}

let fake;
beforeEach(() => {
  fake = fakeDatabase();
  connect.mockResolvedValue(fake);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const settle = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------------ */

describe('isOnline', () => {
  const now = 1_000_000_000_000;
  it('is live while recent and flagged online', () => {
    expect(isOnline({ online: true, at: now - 10_000 }, now)).toBe(true);
  });
  it('is not live once stale, when flagged offline, or with no timestamp', () => {
    expect(isOnline({ online: true, at: now - STALE_MS }, now)).toBe(false);
    expect(isOnline({ online: false, at: now }, now)).toBe(false);
    expect(isOnline({ online: true }, now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
  it('gives a heartbeat several chances inside the stale window', () => {
    expect(STALE_MS / BEAT_MS).toBeGreaterThanOrEqual(3);
  });
});

describe('judging freshness on the server clock', () => {
  // THE asymmetry: Maryam's record is 10 seconds old by the server, but the
  // viewer's clock runs five minutes fast. Without the offset, the viewer sees
  // Maryam as away while Maryam, on a correct clock, sees the viewer online.
  const serverNow = 1_000_000_000_000;
  const skew = 5 * 60 * 1000;

  it('sees a fresh player as online even when the viewer’s clock is wrong', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(serverNow + skew);
    fake = fakeDatabase({ serverClock: () => serverNow, offset: -skew });
    connect.mockResolvedValue(fake);
    fake.put('presence/maryam', { online: true, at: serverNow - 10_000 });

    let seen = null;
    const stop = await watchAll((s) => { seen = s; });
    expect(seen.maryam.online).toBe(true);
    stop();
  });

  it('would have got it wrong using the viewer’s own clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(serverNow + skew);
    fake = fakeDatabase({ serverClock: () => serverNow, offset: 0 });   // no correction
    connect.mockResolvedValue(fake);
    fake.put('presence/maryam', { online: true, at: serverNow - 10_000 });

    let seen = null;
    const stop = await watchAll((s) => { seen = s; });
    expect(seen.maryam.online).toBe(false);
    stop();
  });

  it('corrects as soon as the offset arrives', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(serverNow + skew);
    fake = fakeDatabase({ serverClock: () => serverNow, offset: 0 });
    connect.mockResolvedValue(fake);
    fake.put('presence/maryam', { online: true, at: serverNow - 10_000 });

    let seen = null;
    const stop = await watchAll((s) => { seen = s; });
    expect(seen.maryam.online).toBe(false);
    fake.setOffset(-skew);
    expect(seen.maryam.online).toBe(true);
    stop();
  });
});

describe('the heartbeat repairs a seat marked offline behind its back', () => {
  it('recovers when the same player’s other tab closes', async () => {
    vi.useFakeTimers();
    const stopPhone = await claim('uzair');      // two tabs or devices, one player
    const stopLaptop = await claim('uzair');
    await vi.advanceTimersByTimeAsync(0);
    let seen = null;
    const stopWatch = await watchAll((s) => { seen = s; });
    expect(seen.uzair.online).toBe(true);

    fake.drop(0);                               // the phone's socket goes; its onDisconnect fires
    expect(seen.uzair.online).toBe(false);      // ...and the laptop now looks away to everyone

    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(seen.uzair.online).toBe(true);       // the laptop's heartbeat puts it right

    stopWatch(); stopPhone(); stopLaptop();
  });

  it('recovers after the admin clears every mark', async () => {
    vi.useFakeTimers();
    const stopZahra = await claim('zahra');
    await vi.advanceTimersByTimeAsync(0);
    let seen = null;
    const stopWatch = await watchAll((s) => { seen = s; });
    expect(seen.zahra.online).toBe(true);

    await clearAll();
    expect(seen.zahra.online).toBe(false);

    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(seen.zahra.online).toBe(true);
    stopWatch(); stopZahra();
  });

  it('re-asserts at once when the tab comes back, not a heartbeat later', async () => {
    const stopZain = await claim('zain');
    await settle();
    fake.put('presence/zain', { online: false, at: 1 });
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(fake.root.presence.zain.online).toBe(true);
    stopZain();
  });
});

describe('what claim writes', () => {
  it('keeps the busy match through a reconnect', async () => {
    const stopZain = await claim('zain');
    await settle();
    await setBusy('zain', 'm1');
    fake.setConnected(false);
    fake.setConnected(true);                    // reconnect re-runs the claim
    await settle();
    expect(fake.root.presence.zain).toMatchObject({ online: true, busy: 'm1' });
    stopZain();
  });

  it('marks the seat offline and clears busy on the way out', async () => {
    const stopZain = await claim('zain');
    await settle();
    await setBusy('zain', 'm1');
    stopZain();
    await settle();
    expect(fake.root.presence.zain.online).toBe(false);
    expect(fake.root.presence.zain.busy).toBeUndefined();
  });

  it('arms onDisconnect before claiming, so a crash cannot leave a ghost', async () => {
    const stopZain = await claim('zain');
    await settle();
    fake.drop(0);
    expect(fake.root.presence.zain.online).toBe(false);
    stopZain();
  });
});

describe('clearing marks', () => {
  it('writes each player, never the whole collection — the rules deny that', async () => {
    await clearAll();
    expect(fake.calls.set).not.toContain('presence');
    for (const id of ['uzair', 'maryam', 'zahra', 'zain']) {
      expect(fake.root.presence[id]).toMatchObject({ online: false });
    }
  });
});

describe('watching', () => {
  it('flips a player who went quiet to away without waiting for a write', async () => {
    vi.useFakeTimers();
    fake.put('presence/zahra', { online: true, at: Date.now() });
    let seen = null;
    const stopWatch = await watchAll((s) => { seen = s; });
    expect(seen.zahra.online).toBe(true);
    await vi.advanceTimersByTimeAsync(STALE_MS + TICK_MS);
    expect(seen.zahra.online).toBe(false);
    stopWatch();
  });

  it('only reports when someone’s status actually changes', async () => {
    vi.useFakeTimers();
    const stopZain = await claim('zain');
    await vi.advanceTimersByTimeAsync(0);
    let calls = 0;
    const stopWatch = await watchAll(() => { calls += 1; });
    const after = calls;
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);       // heartbeats and ticks, no change
    expect(calls).toBe(after);
    stopWatch(); stopZain();
  });

  it('reports everyone offline when there is no realtime service', async () => {
    connect.mockResolvedValue(null);
    let seen = null;
    await watchAll((s) => { seen = s; });
    expect(Object.values(seen).every((v) => v.online === false)).toBe(true);
  });
});
