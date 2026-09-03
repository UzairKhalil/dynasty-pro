# Dynasty

Tic tac toe with a persistent series ledger for four players: Uzair, Maryam,
Zahra and Zain. Single self-contained HTML file, no build step, no runtime
dependencies. Chalkboard visual direction — every mark is hand-drawn SVG run
through an `feTurbulence` displacement filter.

## Running it

Open `index.html` in a browser. That's the whole workflow. For a local server:

    npx serve .

## Tests

    npm install          # jsdom only
    npm test

`test/game.test.js` drives the real file in jsdom: four-player setup, both game
modes, king-of-the-hill rotation, and a 250-game randomised soak checking that
the win effect fires every time and the ledger arithmetic never drifts.
`test/storage.test.js` covers the three storage backends and portability.

## Invariants — please don't regress these

These are all fixed bugs. Each one has a test guarding it.

**1. Declare BOTH grid axes on `.cells`.**
`grid-template-columns` alone leaves the rows as implicit `auto` tracks. An auto
row has no definite height, so `height:%` on the mark can't resolve, the browser
falls back to the SVG's intrinsic size, and the rows grow to fit it. The marks
then drift off the chalk grid lines and the winning strike lands on the lines
instead of through the marks. Related: `.cell .mark` is sized by
`width` + `aspect-ratio`, never a percentage height.

**2. Never rebuild the board on a move.**
`buildBoard()` creates cells once per board size. A move calls `paintCell(i)` on
the single changed cell. Rebuilding `#cells.innerHTML` re-creates every mark, so
every existing mark restarts its draw animation — visible as the whole board
flickering on each turn.

**3. Grid lines come from a seeded PRNG.**
`gridMarkup(n)` uses `rng()`, not `Math.random()`, and caches per size. With
`Math.random()` the hand-drawn wobble is re-rolled on every render and the grid
visibly twitches.

**4. Mark shapes are optically centred, not bbox centred.**
The triangle sits at y 16..74, not 20..80, because a triangle's visual weight is
low — centring its bounding box makes it look like it's sitting below centre.
The diamond needs no correction (centroid = centre). Don't "tidy" these numbers.

**5. `celebrate()` forces a reflow.**
`getBoundingClientRect()` between removing and adding the `.won` class is what
makes the flare replay on consecutive wins rather than firing only the first time.

**6. Seats are patched, not rebuilt.**
The four rows in `#seats` are built once by `buildSeats()`; `renderStatus()`
only toggles classes and sets text. Rebuilding causes layout shift each turn.

## Storage

`store` is chosen at runtime: the Claude artifact storage API when
`window.storage` exists, `localStorage` when self-hosted, and `null` when both
are blocked (private browsing) — in which case the footer says so rather than
silently dropping games. Key is `tictactoe:ledger:v3`; bump the version if the
roster or the ledger shape changes, and `heal()` repairs malformed saved data.

The ledger is per-device. A shared table across all four players needs a backend.

## Game rules

**Duel (3×3)** — two players, three in a row. Six pairings, generated from the
roster rather than hardcoded. Winner-stays king of the hill: winner holds the
board, loser goes to the back of the four-deep queue, next waiting player steps
in. On a draw both step off. The starting mark alternates each game.

**Free-for-all (6×6)** — all four, turn order Uzair → Maryam → Zahra → Zain,
four in a row wins. 6×6 gives nine moves each; 5×5 was too cramped for four
players to build a line of four.

Scoring: 3 for a win, 1 for a draw. Head-to-head is tracked for duels only.
