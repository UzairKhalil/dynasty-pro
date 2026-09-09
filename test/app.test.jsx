// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import App from '../src/App.jsx';
import { PLAYERS, P, IDS } from '../src/data/players.js';
import { KEY } from '../src/net/store.js';

// The build now ships a real Firebase config, so without this every test in
// this file would open a socket to the family's live database and assert
// against whatever happened to be in it. Forcing the offline path keeps these
// tests hermetic and deterministic; the cloud path is covered against a fake
// in storage.test.js.
vi.mock('../src/net/firebase.js', () => ({
  config: {},
  isConfigured: () => false,
  connect: async () => null,
  watchConnection: async (cb) => { cb(false); return () => {}; }
}));

const UZAIR = PLAYERS.find((p) => p.id === 'uzair');
const MARYAM = PLAYERS.find((p) => p.id === 'maryam');

const cells = () => [...document.querySelectorAll('.cell')];
const headline = () => document.getElementById('headline').textContent;
const sub = () => document.getElementById('headline-sub').textContent;
const board = () => document.getElementById('cells');

/** Renders and signs in with a code, flushing the async storage open(). */
async function boot(code = UZAIR.code) {
  render(<App />);
  const input = screen.getByLabelText(/five-digit player code/i);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /take my seat/i }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** Starts a two-players-on-one-device duel against `foe`. */
async function startDuel(foe = 'maryam') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`v ${P[foe].name}`, 'i') }));
  await act(async () => { await Promise.resolve(); });
}

async function tap(i) {
  fireEvent.click(cells()[i]);
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});
afterEach(cleanup);

/* ------------------------------------------------------------------ */

describe('code entry', () => {
  it('asks for a code before showing anything else', () => {
    render(<App />);
    expect(screen.getByLabelText(/five-digit player code/i)).toBeTruthy();
    expect(document.querySelector('.cells')).toBeNull();
  });

  it('rejects a wrong code and says so', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText(/five-digit player code/i), { target: { value: '00000' } });
    fireEvent.click(screen.getByRole('button', { name: /take my seat/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/no player with that code/i);
    expect(document.querySelector('.gate')).toBeTruthy();
  });

  it('asks for five digits when the code is too short', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText(/five-digit player code/i), { target: { value: '246' } });
    fireEvent.click(screen.getByRole('button', { name: /take my seat/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/five digits/i);
  });

  it('refuses non-digits in the field', () => {
    render(<App />);
    const input = screen.getByLabelText(/five-digit player code/i);
    fireEvent.change(input, { target: { value: 'ab12cd34' } });
    expect(input.value).toBe('1234');
  });

  it('accepts each player and remembers the seat across a reload', async () => {
    for (const p of PLAYERS) {
      cleanup();
      window.localStorage.clear();
      await boot(p.code);
      expect(screen.getByText(new RegExp(`not ${p.name}\\?`, 'i'))).toBeTruthy();
    }
    cleanup();
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.gate')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe('welcome bar', () => {
  it('names the signed-in player at the top, in their own colour', async () => {
    await boot(UZAIR.code);
    const bar = document.querySelector('.welcome');
    expect(bar).toBeTruthy();
    const name = bar.querySelector('.welcome-name');
    expect(name.textContent).toMatch(/^Uzair/);
    expect(name.getAttribute('style')).toContain('--uzair');
  });

  it('sits above the game columns, not buried in the footer', async () => {
    await boot();
    const bar = document.querySelector('.welcome');
    const cols = document.querySelector('.cols');
    // DOCUMENT_POSITION_FOLLOWING === the columns come after the bar
    expect(bar.compareDocumentPosition(cols) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('greets a new player and welcomes a returning one back', async () => {
    await boot();
    expect(document.querySelector('.welcome-hi').textContent).toBe('Welcome');
    expect(document.querySelector('.welcome-stat').textContent).toMatch(/first game/i);

    await startDuel();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    fireEvent.click(screen.getByRole('button', { name: /lobby/i }));
    await act(async () => { await Promise.resolve(); });

    expect(document.querySelector('.welcome-hi').textContent).toBe('Welcome back');
    expect(document.querySelector('.welcome-stat').textContent).toMatch(/3points · 1st of four/);
  });

  it('flags the admin seat and only the admin seat', async () => {
    await boot(UZAIR.code);
    expect(document.querySelector('.welcome-name .admin-tag')).toBeTruthy();
    cleanup();
    window.localStorage.clear();
    await boot(MARYAM.code);
    expect(document.querySelector('.welcome-name .admin-tag')).toBeNull();
  });

  it('names each player correctly, so nobody plays as a sibling by mistake', async () => {
    for (const p of PLAYERS) {
      cleanup();
      window.localStorage.clear();
      await boot(p.code);
      expect(document.querySelector('.welcome-name').textContent).toMatch(new RegExp(`^${p.name}`));
    }
  });

  it('switches seat from the bar and returns to the gate', async () => {
    await boot(UZAIR.code);
    fireEvent.click(within(document.querySelector('.welcome'))
      .getByRole('button', { name: /not uzair\?/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.gate')).toBeTruthy();
    expect(document.querySelector('.welcome')).toBeNull();
  });

  it('is absent before anyone has signed in', () => {
    render(<App />);
    expect(document.querySelector('.welcome')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe('lobby', () => {
  it('shows all four players with a presence dot', async () => {
    await boot();
    const rows = [...document.querySelectorAll('.who-row')];
    expect(rows).toHaveLength(4);
    expect(document.querySelectorAll('.who-row .dot')).toHaveLength(4);
    expect(rows[0].className).toMatch(/\bme\b/);
  });

  it('offers a local duel against each of the other three, plus the free-for-all', async () => {
    await boot();
    for (const id of IDS.filter((x) => x !== 'uzair')) {
      expect(screen.getByRole('button', { name: new RegExp(`Uzair v ${P[id].name}`) })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /all four/i })).toBeTruthy();
  });

  it('says plainly that online play is off when no realtime service is reachable', async () => {
    await boot();
    expect(screen.getByText(/online play is off/i)).toBeTruthy();
    expect(document.querySelectorAll('button.who-row')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe('INVARIANT 1 — both grid axes are declared on .cells', () => {
  it('sets rows as well as columns on the 3x3 board', async () => {
    await boot();
    await startDuel();
    expect(board().style.gridTemplateColumns).toBe('repeat(3,1fr)');
    expect(board().style.gridTemplateRows).toBe('repeat(3,1fr)');
  });

  it('sets rows as well as columns on the 6x6 board', async () => {
    await boot();
    fireEvent.click(screen.getByRole('button', { name: /all four/i }));
    await act(async () => { await Promise.resolve(); });
    expect(cells()).toHaveLength(36);
    expect(board().style.gridTemplateRows).toBe('repeat(6,1fr)');
  });

  it('sizes the mark from width + aspect-ratio, never a percentage height', async () => {
    await boot();
    await startDuel();
    await tap(0);
    const mark = cells()[0].querySelector('.mark');
    expect(mark.getAttribute('height')).toBeNull();
    expect(mark.style.height).toBe('');
  });
});

describe('INVARIANT 2 — the board is never rebuilt on a move', () => {
  it('keeps the very same cell and mark nodes across later moves', async () => {
    await boot();
    await startDuel();
    await tap(0);
    const cellNode = cells()[0];
    const markNode = cellNode.querySelector('.mark');
    await tap(4);
    await tap(1);
    expect(cells()[0]).toBe(cellNode);
    expect(cells()[0].querySelector('.mark')).toBe(markNode);
  });

  it('leaves an existing mark unanimated so it cannot redraw mid-game', async () => {
    await boot();
    await startDuel();
    await tap(0);
    const first = cells()[0].querySelector('.mark');
    expect(first.classList.contains('fresh')).toBe(true);
    await tap(4);
    // same node, same class list: nothing re-mounted, so nothing re-animates
    expect(cells()[0].querySelector('.mark')).toBe(first);
    expect(cells()[4].querySelector('.mark')).not.toBe(first);
  });
});

describe('INVARIANT 3 — grid lines do not twitch between renders', () => {
  it('keeps identical path data across many moves', async () => {
    await boot();
    await startDuel();
    const read = () => [...document.querySelectorAll('#grid path')].map((p) => p.getAttribute('d'));
    const before = read();
    expect(before).toHaveLength(4);
    await tap(0);
    await tap(4);
    await tap(1);
    expect(read()).toEqual(before);
  });
});

describe('INVARIANT 5 — the win flare replays on consecutive wins', () => {
  it('forces a reflow while applying the won class', async () => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    await boot();
    await startDuel();
    spy.mockClear();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('marks the winning run and only the winning run', async () => {
    await boot();
    await startDuel();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    expect([...document.querySelectorAll('.cell.won')].map((c) => +c.dataset.i)).toEqual([0, 1, 2]);
    expect([...document.querySelectorAll('.cell.faded')].map((c) => +c.dataset.i)).toEqual([3, 4]);
  });

  it('re-flares on a second win in the same session', async () => {
    await boot();
    await startDuel();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    expect(document.querySelectorAll('.cell.won')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /next game/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll('.cell.won')).toHaveLength(0);
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    expect(document.querySelectorAll('.cell.won')).toHaveLength(3);
  });
});

describe('INVARIANT 7 — a straight strike must not use a bbox-relative filter', () => {
  // An SVG filter region defaults to objectBoundingBox units, so it is a
  // PERCENTAGE of the shape's bounding box. A perfectly horizontal strike has
  // zero bbox height, the region collapses to zero, and the browser paints
  // nothing — which silently killed the strike on all six row and column wins.
  // Only the two diagonals ever showed one.
  it('points the .strike rule at the userSpaceOnUse filter', async () => {
    // vitest does not apply stylesheets inside jsdom, so read the rule itself.
    const fs = await import('node:fs');
    const css = fs.readFileSync('src/styles/base.css', 'utf8');
    const rule = /\.strike\{[^}]*\}/.exec(css);
    expect(rule, 'no .strike rule found').toBeTruthy();
    expect(rule[0]).toContain('filter:url(#chalk-line)');
    expect(rule[0]).not.toContain('filter:url(#chalk)');
  });

  it('draws a strike element on a straight win', async () => {
    await boot();
    await startDuel();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);   // top row
    expect(document.querySelector('.strike')).toBeTruthy();
  });

  it('defines both filters, and leaves shapes with area on the bbox one', async () => {
    await boot();
    expect(document.getElementById('chalk').getAttribute('filterUnits')).toBeNull();
    expect(document.getElementById('chalk-line').getAttribute('filterUnits')).toBe('userSpaceOnUse');
  });

  it('covers the whole board viewBox, so a strike near an edge is not clipped', async () => {
    await boot();
    const f = document.getElementById('chalk-line');
    expect(Number(f.getAttribute('x'))).toBeLessThanOrEqual(0);
    expect(Number(f.getAttribute('y'))).toBeLessThanOrEqual(0);
    expect(Number(f.getAttribute('x')) + Number(f.getAttribute('width'))).toBeGreaterThanOrEqual(100);
    expect(Number(f.getAttribute('y')) + Number(f.getAttribute('height'))).toBeGreaterThanOrEqual(100);
  });

  it('draws a strike for every win direction, straight ones included', async () => {
    const lines = {
      row:      [0, 3, 1, 4, 2],
      column:   [0, 1, 3, 2, 6],
      diagonal: [0, 1, 4, 2, 8]
    };
    for (const [name, moves] of Object.entries(lines)) {
      cleanup();
      window.localStorage.clear();
      await boot();
      await startDuel();
      for (const i of moves) await tap(i);
      const strike = document.querySelector('.strike');
      expect(strike, `no strike for a ${name} win`).toBeTruthy();
      const d = strike.getAttribute('d');
      expect(d, `empty strike path for a ${name} win`).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
    }
  });
});

describe('INVARIANT 6 — seats are patched, not rebuilt', () => {
  it('keeps the very same seat nodes as the turn changes', async () => {
    await boot();
    await startDuel();
    const before = [...document.querySelectorAll('.seat')];
    expect(before).toHaveLength(2);
    await tap(0);
    await tap(4);
    expect([...document.querySelectorAll('.seat')]).toEqual(before);
  });

  it('changes only the state text between turns', async () => {
    await boot();
    await startDuel();
    const states = () => [...document.querySelectorAll('.seat-state')].map((s) => s.textContent);
    expect(states()).toEqual(['to play', 'waiting']);
    await tap(0);
    expect(states()).toEqual(['waiting', 'to play']);
  });

  it('lists only the players actually in the game', async () => {
    await boot();
    await startDuel('maryam');
    const names = () => [...document.querySelectorAll('.seat-name')].map((n) => n.textContent);
    expect(names()).toEqual(['Uzair', 'Maryam']);
    expect(document.body.textContent).not.toMatch(/sitting out/i);

    fireEvent.click(screen.getByRole('button', { name: /lobby/i }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: /all four/i }));
    await act(async () => { await Promise.resolve(); });
    expect(names()).toEqual(['Uzair', 'Maryam', 'Zahra', 'Zain']);
  });
});

describe('the playing screen fits a phone', () => {
  // The turn indicator used to render BELOW the board. On a 390px viewport
  // that put it 368px past the board's top edge, so the squares and whose
  // turn it was could never be on screen together.
  it('puts the names and the turn above the board, not below it', async () => {
    await boot();
    await startDuel();
    const seats = document.getElementById('seats');
    const turn = document.getElementById('headline');
    const board = document.querySelector('.board-shell');

    expect(seats.compareDocumentPosition(turn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(turn.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names both players and says whose turn it is, in one place', async () => {
    await boot();
    await startDuel('zahra');
    const bar = document.getElementById('seats');
    expect(bar.textContent).toMatch(/Uzair/);
    expect(bar.textContent).toMatch(/Zahra/);
    // the player on move is marked, not just implied
    const active = bar.querySelector('.seat.active');
    expect(active.querySelector('.seat-name').textContent).toBe('Uzair');
    expect(active.querySelector('.seat-state').textContent).toBe('to play');
    expect(headline()).toMatch(/Uzair/);
  });

  it('colours each name with that player’s own colour', async () => {
    await boot();
    await startDuel('zain');
    const seats = [...document.querySelectorAll('.seat')];
    expect(seats[0].getAttribute('style')).toContain('--uzair');
    expect(seats[1].getAttribute('style')).toContain('--zain');
  });

  it('collapses the lobby chrome while a game is on', async () => {
    await boot();
    expect(document.querySelector('.masthead').className).not.toMatch(/compact/);
    expect(document.querySelector('.welcome')).toBeTruthy();

    await startDuel();
    expect(document.querySelector('.masthead').className).toMatch(/compact/);
    // the welcome bar is lobby context; it must not push the board down
    expect(document.querySelector('.welcome')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /lobby/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.masthead').className).not.toMatch(/compact/);
    expect(document.querySelector('.welcome')).toBeTruthy();
  });

  it('sizes the board against the viewport height, not just the column', async () => {
    const fs = await import('node:fs');
    const base = fs.readFileSync('src/styles/base.css', 'utf8');
    const app = fs.readFileSync('src/styles/app.css', 'utf8');

    // One width drives the whole playing column...
    const playW = /--play-w:[^;]+;/.exec(app);
    expect(playW, 'no --play-w defined').toBeTruthy();
    expect(playW[0], 'board width must respond to viewport height').toMatch(/dvh|vh/);

    // ...and the board consumes it rather than pinning its own 480px.
    const rule = /\.board-shell\{[^}]*\}/.exec(base);
    expect(rule).toBeTruthy();
    expect(rule[0]).toMatch(/var\(--play-w/);
    expect(rule[0]).not.toMatch(/max-width:480px/);
  });

  it('locks the match bar, turn line and actions to the board width', async () => {
    const fs = await import('node:fs');
    const app = fs.readFileSync('src/styles/app.css', 'utf8');
    const shared = /\.play-top,\.seats,\.turnline,\.play-actions\{[^}]*\}/.exec(app);
    expect(shared, 'playing column pieces are not width-locked together').toBeTruthy();
    expect(shared[0]).toMatch(/var\(--play-w\)/);
  });
});

/* ------------------------------------------------------------------ */

describe('playing a duel on one device', () => {
  it('runs a win through to the ledger', async () => {
    await boot();
    await startDuel();
    expect(headline()).toMatch(/Uzair/);
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    expect(headline()).toBe('Uzair wins');
    const row = document.querySelectorAll('#standings .row')[0];
    expect(within(row).getByText('Uzair')).toBeTruthy();
    expect(row.querySelector('.figures b').textContent).toBe('3');
  });

  it('gives a point each for a draw', async () => {
    await boot();
    await startDuel();
    for (const i of [0, 1, 2, 4, 3, 5, 7, 6, 8]) await tap(i);
    expect(headline()).toBe('Drawn');
    const figures = [...document.querySelectorAll('#standings .figures b')].map((b) => b.textContent);
    expect(figures.filter((f) => f === '1')).toHaveLength(2);
  });

  it('rotates king of the hill: winner holds, next in the queue steps in', async () => {
    await boot();
    await startDuel('maryam');
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    expect(sub()).toMatch(/next up Uzair v Zahra/);
    const states = [...document.querySelectorAll('.seat-state')].map((s) => s.textContent);
    expect(states).toEqual(['winner', 'beaten']);
  });

  it('steps both players off after a draw', async () => {
    await boot();
    await startDuel('maryam');
    for (const i of [0, 1, 2, 4, 3, 5, 7, 6, 8]) await tap(i);
    expect(sub()).toMatch(/next up Zahra v Zain/);
  });

  it('ignores a click on a taken square', async () => {
    await boot();
    await startDuel();
    await tap(0);
    await tap(0);
    expect(cells()[0].querySelector('.mark')).toBeTruthy();
    expect(headline()).toMatch(/Maryam/);
  });

  it('undoes a move and hands the turn back', async () => {
    await boot();
    await startDuel();
    await tap(0);
    expect(headline()).toMatch(/Maryam/);
    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    await act(async () => { await Promise.resolve(); });
    expect(cells()[0].querySelector('.mark')).toBeNull();
    expect(headline()).toMatch(/Uzair/);
  });

  it('disables undo with nothing to undo', async () => {
    await boot();
    await startDuel();
    expect(screen.getByRole('button', { name: /^undo$/i }).disabled).toBe(true);
  });

  it('returns to the lobby and keeps the ledger', async () => {
    await boot();
    await startDuel();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    fireEvent.click(screen.getByRole('button', { name: /lobby/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.who-row')).toBeTruthy();
    expect(document.querySelectorAll('#log li')).toHaveLength(1);
  });
});

describe('free-for-all', () => {
  it('cycles all four seats and needs four in a row', async () => {
    await boot();
    fireEvent.click(screen.getByRole('button', { name: /all four/i }));
    await act(async () => { await Promise.resolve(); });
    const order = [];
    for (let i = 0; i < 4; i++) { order.push(headline().split('’')[0]); await tap(i * 6); }
    expect(order).toEqual(['Uzair', 'Maryam', 'Zahra', 'Zain']);
    expect(sub()).toMatch(/4 in a row wins/);
  });
});

describe('against the computer', () => {
  it('lets the bot answer and records the game as vs computer', async () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.change(screen.getByLabelText(/five-digit player code/i), { target: { value: UZAIR.code } });
    fireEvent.click(screen.getByRole('button', { name: /take my seat/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    fireEvent.click(screen.getByRole('button', { name: /start solo game/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll('.seat-tag')).toHaveLength(2); // "you" + "bot"

    fireEvent.click(cells()[4]);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(cells().filter((c) => c.querySelector('.mark'))).toHaveLength(2);

    let guard = 0;
    while (!/wins|Drawn/.test(headline()) && guard++ < 12) {
      const open = cells().find((c) => !c.disabled);
      if (!open) break;
      fireEvent.click(open);
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    }
    expect(headline()).toMatch(/wins|Drawn/);
    expect(document.querySelector('#log li').textContent).toMatch(/vs computer/);
    vi.useRealTimers();
  });
});

/* ------------------------------------------------------------------ */

describe('admin access', () => {
  it('gives Uzair the admin card and the admin tag', async () => {
    await boot(UZAIR.code);
    expect(screen.getByText(/admin · uzair/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /wipe ledger/i })).toBeTruthy();
  });

  it('gives the other three no admin card and no wipe control', async () => {
    for (const p of PLAYERS.filter((x) => x.role !== 'admin')) {
      cleanup();
      window.localStorage.clear();
      await boot(p.code);
      expect(screen.queryByText(/admin ·/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /wipe ledger/i })).toBeNull();
    }
  });

  it('wipes the ledger only on the second press', async () => {
    await boot(UZAIR.code);
    await startDuel();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    fireEvent.click(screen.getByRole('button', { name: /lobby/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll('#log li')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /wipe ledger/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll('#log li')).toHaveLength(1);   // armed, not fired

    fireEvent.click(screen.getByRole('button', { name: /tap again to wipe/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('#log li').className).toBe('empty');
    expect(document.querySelectorAll('#standings .figures b')[0].textContent).toBe('0');
  });

  it('lets an admin strike a single game and leaves the rest standing', async () => {
    await boot(UZAIR.code);
    await startDuel();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    fireEvent.click(screen.getByRole('button', { name: /next game/i }));
    await act(async () => { await Promise.resolve(); });
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    expect(document.querySelectorAll('#log li')).toHaveLength(2);

    const strike = document.querySelectorAll('.strike-game');
    expect(strike).toHaveLength(2);
    fireEvent.click(strike[0]);
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll('#log li')).toHaveLength(1);
  });

  it('shows no strike controls to a non-admin', async () => {
    await boot(MARYAM.code);
    await startDuel('uzair');
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    fireEvent.click(screen.getByRole('button', { name: /lobby/i }));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll('#log li')).toHaveLength(1);
    expect(document.querySelectorAll('.strike-game')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe('the ledger persists', () => {
  it('reloads the table from storage on a fresh mount', async () => {
    await boot();
    await startDuel();
    await tap(0); await tap(3); await tap(1); await tap(4); await tap(2);
    expect(JSON.parse(window.localStorage.getItem(KEY))).toHaveLength(1);

    cleanup();
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelectorAll('#standings .figures b')[0].textContent).toBe('3');
  });

  it('tells the truth about where the scores live', async () => {
    await boot();
    expect(document.getElementById('note').textContent).toMatch(/this device only/i);
  });
});

/* ------------------------------------------------------------------ */

describe('soak — 60 duels driven through the real UI', () => {
  it('flares and strikes on every single win, with the strike through the marks', async () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    await boot();
    await startDuel();

    let wins = 0;
    let strikes = 0;
    let flares = 0;
    let maxOffset = 0;

    for (let g = 0; g < 60; g++) {
      let guard = 0;
      while (guard++ < 12) {
        const open = cells().filter((c) => !c.disabled);
        if (!open.length) break;
        await tap(+open[Math.floor(rnd() * open.length)].dataset.i);
        if (/wins|Drawn/.test(headline())) break;
      }

      if (/wins/.test(headline())) {
        wins++;
        const path = document.querySelector('.strike');
        if (path) strikes++;
        const won = [...document.querySelectorAll('.cell.won')].map((c) => +c.dataset.i);
        if (won.length >= 3) flares++;

        const [x1, y1, x2, y2] = path.getAttribute('d')
          .replace(/[ML]/g, ' ').trim().split(/[\s,]+/).map(Number);
        const n = Math.sqrt(cells().length);
        const step = 100 / n;
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        for (const i of won) {
          const cx = ((i % n) + 0.5) * step;
          const cy = (Math.floor(i / n) + 0.5) * step;
          const off = Math.abs((x2 - x1) * (cy - y1) - (cx - x1) * (y2 - y1)) / len;
          maxOffset = Math.max(maxOffset, off);
        }
      }

      fireEvent.click(screen.getByRole('button', { name: /next game|restart game/i }));
      await act(async () => { await Promise.resolve(); });
    }

    expect(wins).toBeGreaterThan(20);
    expect(strikes).toBe(wins);
    expect(flares).toBe(wins);
    expect(maxOffset).toBeLessThan(0.02);

    // The ledger arithmetic must not have drifted over 60 games.
    const stored = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    expect(stored).toHaveLength(60);

    const figures = [...document.querySelectorAll('#standings .figures')]
      .map((f) => f.textContent.match(/(\d+) played(\d+)W · (\d+)D · (\d+)L/).slice(1).map(Number));
    expect(figures).toHaveLength(4);
    for (const [played, w, d, l] of figures) {
      expect(played).toBe(w + d + l);
    }
    // two seats per duel, sixty duels
    expect(figures.reduce((a, f) => a + f[0], 0)).toBe(120);
  }, 60_000);
});

/* ------------------------------------------------------------------ */

describe('error boundary', () => {
  it('shows a recoverable message instead of a blank page', async () => {
    const Boom = () => { throw new Error('board exploded'); };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    // jsdom also reports the deliberate throw as an uncaught window error;
    // swallow it so a passing run doesn't print a scary stack trace.
    const swallow = (e) => e.preventDefault();
    window.addEventListener('error', swallow);
    const ErrorBoundary = (await import('../src/components/ErrorBoundary.jsx')).default;

    render(<ErrorBoundary><Boom /></ErrorBoundary>);

    expect(screen.getByText(/something broke/i)).toBeTruthy();
    expect(screen.getByText(/board exploded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
    // the ledger must never be offered up for deletion as a "fix"
    expect(screen.queryByRole('button', { name: /wipe|clear|reset/i })).toBeNull();
    window.removeEventListener('error', swallow);
    quiet.mockRestore();
  });

  it('renders children untouched when nothing throws', async () => {
    const ErrorBoundary = (await import('../src/components/ErrorBoundary.jsx')).default;
    render(<ErrorBoundary><p>all good</p></ErrorBoundary>);
    expect(screen.getByText('all good')).toBeTruthy();
    expect(screen.queryByText(/something broke/i)).toBeNull();
  });
});

describe('published-site basics', () => {
  it('ships a favicon and links it relatively, so any Pages URL works', async () => {
    const fs = await import('node:fs');
    expect(fs.existsSync('public/favicon.svg')).toBe(true);
    const html = fs.readFileSync('index.html', 'utf8');
    expect(html).toMatch(/<link rel="icon" href="\.\/favicon\.svg"/);
    expect(html).not.toMatch(/href="\/favicon/);      // an absolute path breaks a project page
  });
});

/* ------------------------------------------------------------------ */

describe('the challenge card', () => {
  // The row used to be one big button with the action as a FOURTH child while
  // the phone breakpoint declared only three grid columns. The action wrapped
  // onto its own line under the name and read as a rendering bug.
  const online = (ids) => Object.fromEntries(
    PLAYERS.map((p) => [p.id, { online: ids.includes(p.id), at: Date.now(), busy: null }]));

  async function lobby(props = {}) {
    const Lobby = (await import('../src/components/Lobby.jsx')).default;
    render(
      <Lobby
        me="uzair"
        presence={online(['uzair', 'maryam'])}
        online
        invite={null}
        outgoing={null}
        onChallenge={() => {}}
        onRespond={() => {}}
        onCancel={() => {}}
        onLocal={() => {}}
        onSolo={() => {}}
        {...props}
      />
    );
  }

  it('gives every row exactly one line: mark, name over status, action', async () => {
    await lobby();
    const rows = [...document.querySelectorAll('.who-row')];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      // mark + id block, plus the action only when there is one
      expect(row.children.length).toBeLessThanOrEqual(3);
      expect(row.querySelector('.who-mark')).toBeTruthy();
      expect(row.querySelector('.who-name')).toBeTruthy();
      expect(row.querySelector('.who-state')).toBeTruthy();
    }
  });

  it('keeps the status word visible — a bare dot says nothing', async () => {
    await lobby();
    const states = [...document.querySelectorAll('.who-state')].map((s) => s.textContent.trim());
    expect(states).toEqual(['you', 'online', 'away', 'away']);
    // and each carries its own dot
    expect(document.querySelectorAll('.who-state .dot')).toHaveLength(4);
  });

  it('offers a real button to challenge, only for who can be challenged', async () => {
    await lobby();
    const buttons = [...document.querySelectorAll('.who-go')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].tagName).toBe('BUTTON');
    expect(buttons[0].textContent).toBe('Challenge');
    // it belongs to the online player who is not me
    expect(buttons[0].closest('.who-row').querySelector('.who-name').textContent).toBe('Maryam');
  });

  it('fires the challenge with the right player', async () => {
    const seen = [];
    await lobby({ onChallenge: (id) => seen.push(id) });
    fireEvent.click(document.querySelector('.who-go'));
    expect(seen).toEqual(['maryam']);
  });

  it('offers nobody while a challenge of your own is pending', async () => {
    await lobby({ outgoing: { matchId: 'm1', guest: 'maryam' } });
    expect(document.querySelectorAll('.who-go')).toHaveLength(0);
    expect(screen.getByText(/waiting for/i)).toBeTruthy();
  });

  it('will not offer a challenge to someone already in a game', async () => {
    const busy = online(['uzair', 'maryam']);
    busy.maryam.busy = 'm1';
    await lobby({ presence: busy });
    expect(document.querySelectorAll('.who-go')).toHaveLength(0);
    expect(document.body.textContent).toMatch(/in a game/);
  });

  it('presents an incoming challenge as two clear choices', async () => {
    await lobby({ invite: { matchId: 'm1', from: 'maryam', mode: 'duel' } });
    const banner = document.querySelector('.banner');
    expect(banner.textContent).toMatch(/Maryam/);
    expect(within(banner).getByRole('button', { name: /accept/i })).toBeTruthy();
    expect(within(banner).getByRole('button', { name: /decline/i })).toBeTruthy();
  });

  it('stacks the banner and its choices on a phone', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('src/styles/app.css', 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width:560px)'));
    expect(phone).toMatch(/\.banner\{[^}]*flex-direction:column/);
  });

  it('never re-declares the row with fewer columns than it has children', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('src/styles/app.css', 'utf8');
    // exactly one grid-template-columns for .who-row, and it declares three
    const decls = css.match(/\.who-row\{[^}]*grid-template-columns:[^;]+;/g) || [];
    expect(decls).toHaveLength(1);
    expect(decls[0]).toMatch(/grid-template-columns:\s*26px\s+minmax\(0,1fr\)\s+auto/);
    expect(css).not.toMatch(/\.who-row\{grid-template-columns:22px/);
  });
});
