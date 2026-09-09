# Dynasty

Tic tac toe with a shared series ledger for four players: Uzair, Maryam, Zahra
and Zain. React + Vite, deployed as a static site to GitHub Pages. Chalkboard
visual direction — every mark is hand-drawn SVG run through an `feTurbulence`
displacement filter.

Three ways to play: two people on one device, one person against the computer,
or two people online on separate devices.

## Running it

    npm install
    npm run dev          # http://localhost:5173
    npm test             # vitest, 116 assertions
    npm run build        # -> dist/

`npm run dev` with no `.env.local` runs in local-only mode: everything works
except online play, and the footer says so.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` runs the tests, builds, and
publishes `dist/` to Pages. Enable it once at **Settings → Pages → Source →
GitHub Actions**.

`vite.config.js` sets `base: './'` so the same build works at a user page
(`user.github.io`) and a project page (`user.github.io/dynasty-pro/`) with no
repo-name edit. **This holds only because the app has no path-based router.**
Adding one means setting `base` to the repo name and adding a `404.html`.

## Architecture — what runs where

GitHub Pages is a read-only file server. It serves files and runs nothing, so:

| Feature | Needs a service? |
|---|---|
| Profiles, codes, pass-and-play, vs computer | No — pure static |
| Ledger on one device | No — `localStorage` |
| Online play, presence, shared ledger | **Yes** — Firebase Realtime Database |

Firebase is the only thing not served by Pages. It is loaded through a dynamic
`import()` in `src/net/firebase.js`, so a build with no config never downloads
the SDK — it lands in its own chunk. **Never convert that to a static import**;
it would pull ~180KB into the entry chunk for every visitor, configured or not.
`test/storage.test.js` guards this.

Config comes from `VITE_FIREBASE_*` (see `.env.example`). These are *variables*,
not secrets: Firebase web config is public by design and ends up in the bundle
regardless. `firebase.rules.json` is what actually constrains writes.

## Codes and the admin role are not security

`src/data/players.js` holds each player's five-digit `code` and a `role`
(`uzair` is `admin`, the rest are `player`). Both ship in the JS bundle and are
readable in devtools by anyone who opens the site.

They exist to stop **accidents**, not attackers: they put four people in the
right seat and keep three of them from wiping the shared table by mistake.
Don't put anything behind them you'd mind a stranger seeing or changing. Real
per-player permissions would need Firebase Anonymous Auth with a uid → player
map, and rules gated on the uid.

Admin (Uzair) gets: wipe the whole ledger, strike a single game from the record
via the × in Recent games, and clear stale presence marks. Each is a two-press
confirm.

## Invariants — please don't regress these

These are all fixed bugs carried over from the pre-React build. Each has a test.

**1. Declare BOTH grid axes on `.cells`.** (`Board.jsx`)
`grid-template-columns` alone leaves the rows as implicit `auto` tracks. An auto
row has no definite height, so `height:%` on the mark can't resolve, the browser
falls back to the SVG's intrinsic size, and the rows grow to fit it. The marks
then drift off the chalk grid lines and the winning strike lands on the lines
instead of through the marks. Related: `.cell .mark` is sized by `width` +
`aspect-ratio`, never a percentage height.

**2. Never rebuild the board on a move.** (`Mark.jsx`)
`Mark` freezes its `animated` prop into state at mount, so the draw animation
fires once and no later re-render restarts it. Cells keep stable keys off their
index. In the old imperative build the same bug was rebuilding `#cells.innerHTML`
on every move — visible as the whole board flickering each turn.

**3. Grid lines come from a seeded PRNG.** (`rules.js`)
`gridPaths(n)` uses `rng()`, not `Math.random()`, and caches per size. With
`Math.random()` the hand-drawn wobble is re-rolled on every render and the grid
visibly twitches.

**4. Mark shapes are optically centred, not bbox centred.** (`rules.js`)
The triangle sits at y 16..74, not 20..80, because a triangle's visual weight is
low — centring its bounding box makes it look like it's sitting below centre.
The diamond needs no correction (centroid = centre). Don't "tidy" these numbers.

**5. `Board` forces a reflow between removing and adding `.won`.** (`Board.jsx`)
That `getBoundingClientRect()` in the layout effect is what makes the flare
replay on consecutive wins rather than firing only the first time. The `won`
class is applied imperatively for exactly this reason — declaring it in
`className` lets React coalesce the change and the animation never restarts.

**6. Seats are patched, not rebuilt.** (`Seats.jsx`)
Stable keys off the player id mean only class names and text change between
turns. Rebuilding shifts the layout under a thumb already reaching for a square.
Note the seat bar lists only the players *in* the game — it used to render all
four with two marked "sitting out", which on a phone pushed the board and the
turn indicator onto separate screens.

**7. A straight strike needs a userSpaceOnUse filter.** (`ChalkDefs.jsx`)
SVG filter regions default to objectBoundingBox units — a percentage of the
shape's bounding box. A horizontal or vertical strike has a zero-extent bbox,
so the region collapses and the browser paints nothing. That silently killed
the strike on all six row and column wins; only the two diagonals ever drew
one. `#chalk-line` is the fixed-region filter for anything straight; `#chalk`
stays on bbox units for shapes with area.

## The playing screen is mobile-first

`--play-w` in `app.css` is one width for the whole playing column — match bar,
turn line, board, actions — and it is sized against the **viewport height**
(`dvh`, so mobile browser chrome counts), not just the column. On a phone those
four have to share one screen. They are ordered names → turn → board → actions
for the same reason: the turn indicator used to sit *below* the board, which on
a 390px viewport put it 368px past the board's top edge, so you could never see
the squares and whose turn it was at once.

The lobby's challenge rows follow the same rule: `.who-row` is **three columns,
declared once** — mark | name over status | action — and no breakpoint may
re-declare it with fewer. It used to be a single clickable row with the action
as a fourth child while the phone breakpoint declared only three columns, so
the challenge control wrapped under the name and looked broken. The action is
now a real `<button>`, which is also a clearer tap target than a list row that
happens to be clickable, and the status word stays visible — a bare dot with no
label says nothing.

Under 560px wide, or under 700px tall, the masthead is hidden during a game and
the welcome bar is dropped — roughly 110px the board needs more than the
wordmark does. "← Lobby" carries the navigation. Verified at 360×640, 390×780,
430×860, 820×660 and 1200×1000; the whole game fits one screen at every one.

## Online rounds

A match carries a **`round` counter**, and `adopt()` in `src/net/match.js` is
what decides whether an incoming snapshot replaces the local board: a new round
always wins, however few moves it has; within the same round, fewer moves means
a stale echo of our own optimistic move and is refused. Comparing move counts
alone is a real bug that shipped — a fresh board has 0 moves against a finished
one's 5, so the player who did not press "play again" kept staring at the old
result while the other played on.

**Both players must agree before the next round starts.** Pressing "Play again"
writes `rematch/{player}`; only when every seat has asked does the **host** (and
only the host, so two clients cannot push two different boards at once) call
`startRound()`, which sets the new game, increments `round` and clears
`rematch` in one update. Pressing the waiting button withdraws the request.

## Storage

`src/net/store.js` picks a backend at runtime: **cloud** (Firebase, shared by
all four across every device), **local** (`localStorage`, this device only), or
**none** (private browsing with storage blocked) — in which case the footer says
so rather than silently dropping games. The cloud path mirrors to
`localStorage`, so a dropped connection shows the last known table instead of an
empty one. Key is `dynasty:games:v4`; bump it if the game-entry shape changes.

**The ledger is a pure fold over an append-only game list, never a running
total.** `foldGames()` in `src/game/ledger.js` rebuilds standings, head-to-head
and streaks from scratch every time. That is what makes the shared cloud copy
conflict-free: two devices finishing games at once can't clobber each other's
arithmetic, because nobody ever writes a total. Keep it that way — storing
computed totals reintroduces the whole class of sync bug.

Realtime Database drops nulls inside arrays, which would turn a half-played
board into a sparse object, so `src/net/match.js` encodes the board as one char
per cell (`'.'` for empty, otherwise the player's roster index).

## Game rules

**Duel (3×3)** — two players, three in a row. Six pairings, generated from the
roster rather than hardcoded. On one device it runs winner-stays king of the
hill: winner holds the board, loser goes to the back of the four-deep queue,
next waiting player steps in. On a draw both step off. The starting mark
alternates each game.

**Free-for-all (6×6)** — all four, turn order Uzair → Maryam → Zahra → Zain,
four in a row wins. 6×6 gives nine moves each; 5×5 was too cramped for four
players to build a line of four.

**Computer** — three levels in `src/game/ai.js`. `ruthless` solves 3×3 outright
with alpha-beta minimax and cannot be beaten; on 6×6 it falls back to the window
heuristic, because the tree is far too wide to search. `easy` and `steady` are
the same engine with a blunder rate. Win-then-block always precedes positional
scoring. `chooseMove` takes an injectable `rand` so tests are deterministic.

Scoring: 3 for a win, 1 for a draw. Head-to-head is tracked for duels only.

## Layout

    src/data/players.js     roster, codes, roles, derived pairings
    src/game/rules.js       shapes, PRNG, findWin, pure move reducers
    src/game/ledger.js      blankLedger, heal, foldGames, standings
    src/game/ai.js          the computer opponent
    src/net/firebase.js     lazy SDK load; null when unconfigured
    src/net/presence.js     online/offline via onDisconnect
    src/net/match.js        invites, board sync, wire encoding
    src/net/store.js        the three ledger backends
    src/components/         Board, Mark, Grid, Strike, Seats, Lobby, Admin…
    legacy/                 the pre-React single-file build, for reference

`legacy/index.html` is the original self-contained version. It still runs by
opening it in a browser and is kept only as a reference for the visual
direction; it is not built, tested, or deployed.
