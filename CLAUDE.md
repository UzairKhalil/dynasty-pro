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
Stable keys off the roster mean only class names and text change between turns.
Rebuilding causes layout shift each turn.

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
