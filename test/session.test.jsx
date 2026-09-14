// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';

// Hermetic: never let these tests reach the family's live database.
vi.mock('../src/net/firebase.js', () => ({
  config: {},
  isConfigured: () => false,
  connect: async () => null,
  watchConnection: async (cb) => { cb(false); return () => {}; }
}));

import App from '../src/App.jsx';
import { parseUA } from '../src/net/device.js';
import { IDLE_MS, ACTIVE_KEY, isExpired, readActive, writeActive } from '../src/net/idle.js';
import { clean, normaliseLogin, LOCAL_KEY, CAP, recordLogin } from '../src/net/logins.js';
import { PLAYERS } from '../src/data/players.js';

const UZAIR = PLAYERS.find((p) => p.id === 'uzair');
const MARYAM = PLAYERS.find((p) => p.id === 'maryam');
const ME_KEY = 'dynasty:me';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const flushFake = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function boot(code = UZAIR.code) {
  render(<App />);
  fireEvent.change(screen.getByLabelText(/five-digit player code/i), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /take my seat/i }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const onGate = () => Boolean(document.querySelector('.gate'));
const idleNotice = () => document.querySelector('.gate-notice');
const logins = () => JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '[]');

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', window.location.pathname);
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, '', window.location.pathname);
});

/* ================================================================== */

describe('parseUA', () => {
  it('names an Android phone by model, system and browser', () => {
    const d = parseUA('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36');
    expect(d).toMatchObject({ model: 'SM-S918B', os: 'Android 14', browser: 'Chrome 128', type: 'mobile' });
    expect(d.label).toBe('SM-S918B · Android 14 · Chrome 128');
  });

  it('ignores the "K" placeholder in Chrome’s reduced user agent', () => {
    const d = parseUA('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36');
    expect(d.model).toBe('');
    expect(d.os).toBe('Android 10');
  });

  it('prefers client hints for the real model and version when they exist', () => {
    const d = parseUA('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36', { mobile: true, platform: 'Android' },
      { model: 'Pixel 8', platformVersion: '14.0.0' });
    expect(d).toMatchObject({ model: 'Pixel 8', os: 'Android 14' });
  });

  it('calls an iPhone an iPhone — Safari never reveals the exact model', () => {
    const d = parseUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1');
    expect(d).toMatchObject({ model: 'iPhone', os: 'iOS 17.4', browser: 'Safari 17.4', type: 'mobile' });
  });

  it('knows Chrome on iOS is Chrome, not Safari', () => {
    const d = parseUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1');
    expect(d.browser).toBe('Chrome 128');
  });

  it('spots Edge and Samsung Internet behind their Chrome claims', () => {
    expect(parseUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0')).toMatchObject({
      browser: 'Edge 128', os: 'Windows 10/11', type: 'desktop', model: '' });
    expect(parseUA('Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36').browser).toBe('Samsung Internet 25');
  });

  it('tells Windows 11 from 10 only when client hints say so', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    expect(parseUA(ua, null, { platformVersion: '15.0.0' }).os).toBe('Windows 11');
    expect(parseUA(ua, null, { platformVersion: '10.0.0' }).os).toBe('Windows 10');
  });

  it('unmasks an iPad that reports itself as a Mac', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(parseUA(ua, null, {}, 0)).toMatchObject({ os: 'macOS', type: 'desktop' });
    expect(parseUA(ua, null, {}, 5)).toMatchObject({ os: 'iPadOS', type: 'tablet', model: 'iPad' });
  });

  it('treats an Android without "Mobile" as a tablet', () => {
    expect(parseUA('Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/128.0.0.0 Safari/537.36').type).toBe('tablet');
  });

  it('does not mistake Firefox’s "Mobile" token for a model', () => {
    expect(parseUA('Mozilla/5.0 (Android 14; Mobile; rv:129.0) Gecko/129.0 Firefox/129.0'))
      .toMatchObject({ model: '', os: 'Android 14', browser: 'Firefox 129' });
  });

  it('survives an empty or missing user agent', () => {
    expect(parseUA('').label).toBe('Unknown device');
    expect(parseUA(undefined).label).toBe('Unknown device');
  });
});

/* ================================================================== */

describe('isExpired', () => {
  const now = 1_800_000_000_000;
  it('is fresh inside the window and expired at the edge', () => {
    expect(isExpired(now - IDLE_MS + 1000, now)).toBe(false);
    expect(isExpired(now - IDLE_MS, now)).toBe(true);
  });

  it('treats a missing or unreadable timestamp as expired', () => {
    for (const bad of [0, undefined, null, NaN, 'nope']) expect(isExpired(bad, now)).toBe(true);
  });

  it('is exactly 30 minutes', () => {
    expect(IDLE_MS).toBe(30 * 60 * 1000);
  });

  it('round-trips through storage', () => {
    writeActive(12345);
    expect(readActive()).toBe(12345);
    writeActive(0);
    expect(readActive()).toBe(0);
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBeNull();
  });
});

/* ================================================================== */

describe('idle sign-out on load', () => {
  it('asks for the code again when the remembered seat is over 30 minutes stale', () => {
    window.localStorage.setItem(ME_KEY, 'uzair');
    writeActive(Date.now() - IDLE_MS - 1000);
    render(<App />);
    expect(onGate()).toBe(true);
    expect(idleNotice().textContent).toMatch(/30 minutes/);
    expect(window.localStorage.getItem(ME_KEY)).toBeNull();
  });

  it('asks for the code when a seat was remembered from before idle tracking existed', () => {
    window.localStorage.setItem(ME_KEY, 'uzair');           // no active timestamp at all
    render(<App />);
    expect(onGate()).toBe(true);
  });

  it('keeps a seat used within the last 30 minutes', () => {
    window.localStorage.setItem(ME_KEY, 'uzair');
    writeActive(Date.now() - 5 * 60 * 1000);
    render(<App />);
    expect(onGate()).toBe(false);
    expect(document.querySelector('.welcome-name').textContent).toMatch(/^Uzair/);
  });

  it('shows no idle notice on an ordinary first visit', () => {
    render(<App />);
    expect(onGate()).toBe(true);
    expect(idleNotice()).toBeNull();
  });
});

describe('idle sign-out while open', () => {
  it('signs out after 30 minutes with no input', async () => {
    vi.useFakeTimers();
    await boot();
    expect(onGate()).toBe(false);
    await act(async () => { vi.advanceTimersByTime(IDLE_MS + 16_000); });
    await flushFake();
    expect(onGate()).toBe(true);
    expect(idleNotice()).toBeTruthy();
  });

  it('is kept alive by the player’s own taps', async () => {
    vi.useFakeTimers();
    await boot();
    await act(async () => { vi.advanceTimersByTime(20 * 60 * 1000); });
    fireEvent.pointerDown(window);
    await act(async () => { vi.advanceTimersByTime(20 * 60 * 1000); });
    expect(onGate()).toBe(false);                            // 40 min open, 20 since input
    await act(async () => { vi.advanceTimersByTime(11 * 60 * 1000); });
    await flushFake();
    expect(onGate()).toBe(true);
  });

  it('checks the clock the moment the tab comes back, not at the next tick', async () => {
    await boot();
    writeActive(Date.now() - IDLE_MS - 1);                  // slept in a pocket
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(onGate()).toBe(true);
  });

  it('signs out on the first tap after a long absence instead of counting it as activity', async () => {
    await boot();
    const stale = Date.now() - IDLE_MS - 1;
    writeActive(stale);
    await act(async () => { fireEvent.pointerDown(window); });
    expect(onGate()).toBe(true);
    // and the stale timestamp was not refreshed by that tap
    expect(readActive()).toBe(0);
  });

  it('leaves a local game behind and returns to a clean lobby after signing back in', async () => {
    await boot();
    fireEvent.click(screen.getByRole('button', { name: /Uzair v Maryam/i }));
    await flush();
    expect(document.querySelector('.board-shell')).toBeTruthy();
    writeActive(Date.now() - IDLE_MS - 1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(onGate()).toBe(true);
    fireEvent.change(screen.getByLabelText(/five-digit player code/i), { target: { value: UZAIR.code } });
    fireEvent.click(screen.getByRole('button', { name: /take my seat/i }));
    await flush();
    expect(document.querySelector('.board-shell')).toBeNull();
    expect(idleNotice()).toBeNull();
  });
});

/* ================================================================== */

describe('sign-in records', () => {
  it('records who signed in, when, and on what device — but never the code', async () => {
    await boot(MARYAM.code);
    await flush();
    const [entry] = logins();
    expect(entry).toMatchObject({ player: 'maryam', kind: 'in' });
    expect(entry.at).toBeGreaterThan(0);
    expect(typeof entry.deviceId).toBe('string');
    expect(entry.device.label).toBeTruthy();

    const walk = (v, out = []) => {
      if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.push(k); walk(x, out); });
      else out.push(v);
      return out;
    };
    const everything = walk(entry);
    expect(everything).not.toContain('code');
    expect(everything).not.toContain(MARYAM.code);
  });

  it('records a manual sign-out with a plain reason, not the click event', async () => {
    await boot();
    fireEvent.click(within(document.querySelector('.welcome')).getByRole('button', { name: /not uzair\?/i }));
    await flush();
    const [latest] = logins();
    expect(latest).toMatchObject({ player: 'uzair', kind: 'out', reason: 'manual' });
  });

  it('records an idle sign-out as idle', async () => {
    await boot();
    writeActive(Date.now() - IDLE_MS - 1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await flush();
    expect(logins()[0]).toMatchObject({ kind: 'out', reason: 'idle' });
  });

  it('keeps one stable device id across sign-ins on the same device', async () => {
    await boot();
    fireEvent.click(within(document.querySelector('.welcome')).getByRole('button', { name: /not uzair\?/i }));
    await flush();
    fireEvent.change(screen.getByLabelText(/five-digit player code/i), { target: { value: MARYAM.code } });
    fireEvent.click(screen.getByRole('button', { name: /take my seat/i }));
    await flush();
    expect(new Set(logins().map((e) => e.deviceId)).size).toBe(1);
  });

  it('tells people on the code screen that sign-ins are recorded', () => {
    render(<App />);
    expect(document.querySelector('.gate-privacy').textContent).toMatch(/device details/i);
  });
});

describe('logins storage', () => {
  it('strips undefined and non-finite values Firebase would reject', () => {
    expect(clean({ a: 1, b: undefined, c: NaN, d: { e: undefined, f: 'x' }, g: null }))
      .toEqual({ a: 1, d: { f: 'x' }, g: null });
  });

  it('rejects junk and normalises the kind', () => {
    expect(normaliseLogin('x', null)).toBeNull();
    expect(normaliseLogin('x', { kind: 'in' })).toBeNull();
    expect(normaliseLogin('x', { player: 'zain', kind: 'weird', at: 5 }))
      .toMatchObject({ id: 'x', player: 'zain', kind: 'in', at: 5, device: {} });
  });

  it('keeps the newest entries when offline, capped', async () => {
    for (let i = 0; i < CAP + 3; i++) await recordLogin('zahra', 'in');
    const list = logins();
    expect(list).toHaveLength(CAP);
    expect(list[0].at).toBeGreaterThanOrEqual(list[list.length - 1].at);
  });
});

/* ================================================================== */

describe('the sign-in history page', () => {
  // There is deliberately no button for it: the admin types .../#history.
  async function openHistory() {
    await act(async () => {
      window.location.hash = 'history';
      await new Promise((r) => setTimeout(r, 20));
    });
    await flush();
  }

  it('has no button anywhere — it is reached by URL only', async () => {
    await boot(UZAIR.code);
    await flush();
    expect(screen.queryByRole('button', { name: /history/i })).toBeNull();
    expect(document.querySelector('.admin-card').textContent).not.toMatch(/history/i);
  });

  it('opens as its own page for the admin at #history', async () => {
    await boot(UZAIR.code);
    await flush();
    await openHistory();
    expect(document.getElementById('history')).toBeTruthy();
    expect(window.location.hash).toBe('#history');
    // a page, not a panel: the lobby and the standings are gone
    expect(document.querySelector('.cols')).toBeNull();
    expect(document.querySelector('.welcome')).toBeNull();
  });

  it('lists the admin’s own sign-in as a table row with its device', async () => {
    await boot(UZAIR.code);
    await flush();
    await openHistory();
    const first = document.querySelector('.login-table tbody tr.login');
    expect(first.textContent).toMatch(/Uzair/);
    expect(first.textContent).toMatch(/signed in/);
    expect(first.querySelector('.login-device').textContent.length).toBeGreaterThan(0);
  });

  it('gives every device detail its own column', async () => {
    await boot(UZAIR.code);
    await flush();
    await openHistory();
    const heads = [...document.querySelectorAll('.login-table thead th')].map((th) => th.textContent);
    for (const h of ['Player', 'When', 'Event', 'Device', 'Type', 'Model', 'System', 'Browser',
      'Screen', 'Window', 'Touch', 'Cores', 'Memory', 'Network', 'Language', 'Time zone',
      'Device id', 'User agent']) {
      expect(heads).toContain(h);
    }
    // and each row has a cell under every heading
    const row = document.querySelector('.login-table tbody tr');
    expect(row.children).toHaveLength(heads.length);
  });

  it('lists each device once in the devices-seen table', async () => {
    await boot(UZAIR.code);
    await flush();
    await openHistory();
    expect(document.querySelectorAll('.devices-table tbody tr')).toHaveLength(1);
  });

  it('scrolls the table inside its own box and pins the player column', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('src/styles/app.css', 'utf8');
    expect(css).toMatch(/\.table-wrap\{[^}]*overflow-x:auto/);
    expect(css).toMatch(/\.data-table \.sticky\{[^}]*position:sticky;left:0/);
    await boot(UZAIR.code);
    await flush();
    await openHistory();
    expect(document.querySelector('.login-table tbody td.sticky .who-name')).toBeTruthy();
  });

  it('marks only the first sign-in from a device as new', async () => {
    await boot(UZAIR.code);
    await flush();
    fireEvent.click(within(document.querySelector('.welcome')).getByRole('button', { name: /not uzair\?/i }));
    await flush();
    fireEvent.change(screen.getByLabelText(/five-digit player code/i), { target: { value: UZAIR.code } });
    fireEvent.click(screen.getByRole('button', { name: /take my seat/i }));
    await flush();
    await openHistory();
    expect(document.querySelectorAll('.login-table tbody tr.login')).toHaveLength(3);  // in, out, in
    expect(document.querySelectorAll('.login-new')).toHaveLength(1);
  });

  it('filters by player', async () => {
    await recordLogin('zain', 'in');
    await boot(UZAIR.code);
    await flush();
    await openHistory();
    fireEvent.click(within(document.querySelector('.history-filter')).getByRole('button', { name: /^Zain$/ }));
    const names = [...document.querySelectorAll('.login .who-name')].map((n) => n.textContent);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n === 'Zain')).toBe(true);
  });

  it('goes back to the lobby and drops the hash', async () => {
    await boot(UZAIR.code);
    await flush();
    await openHistory();
    fireEvent.click(within(document.getElementById('history')).getByRole('button', { name: /lobby/i }));
    await flush();
    expect(document.getElementById('history')).toBeNull();
    expect(document.querySelector('.cols')).toBeTruthy();
    expect(window.location.hash).toBe('');
  });

  it('lands the admin on the page when the URL is opened before signing in', async () => {
    window.location.hash = 'history';
    await boot(UZAIR.code);
    await flush();
    expect(document.getElementById('history')).toBeTruthy();
  });

  it('clears only on the second press', async () => {
    await boot(UZAIR.code);
    await flush();
    await openHistory();
    fireEvent.click(screen.getByRole('button', { name: /^clear history$/i }));
    await flush();
    expect(document.querySelectorAll('.login').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /tap again to clear history/i }));
    await flush();
    expect(document.querySelectorAll('.login')).toHaveLength(0);
  });

  it('shows anyone else the ordinary lobby, even at the address', async () => {
    await boot(MARYAM.code);
    await openHistory();
    expect(document.getElementById('history')).toBeNull();
    expect(document.querySelector('.cols')).toBeTruthy();
    cleanup();
    window.location.hash = 'history';
    window.localStorage.setItem(ME_KEY, 'maryam');
    writeActive(Date.now());
    render(<App />);
    await flush();
    expect(document.getElementById('history')).toBeNull();
    expect(document.querySelector('.cols')).toBeTruthy();
  });
});
