# Dynasty

Tic tac toe with a shared series ledger for four players — Uzair, Maryam, Zahra
and Zain. React + Vite, deployed as a static site to GitHub Pages.

Three ways to play:

- **On this device** — pass the phone around. Duels run winner-stays.
- **Against the computer** — three levels; the hardest solves 3×3 and can't be beaten.
- **Online** — challenge whoever's online from the lobby, on separate devices.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Enter a five-digit player code to take your seat. Codes live in
[`src/data/players.js`](src/data/players.js).

| Player | Code |
|---|---|
| Uzair  | `24680` (admin) |
| Maryam | `13579` |
| Zahra  | `11223` |
| Zain   | `90210` |

Change them by editing that file — the roster is the single source of truth, and
pairings, head-to-head buckets and seats are all derived from it.

## Deploying to GitHub Pages

1. Push the repo to GitHub.
2. **Settings → Pages → Source → GitHub Actions.**
3. Push to `main`. That's it — the workflow tests, builds and publishes.

The build uses a relative base path, so it works at both `user.github.io` and
`user.github.io/dynasty-pro/` without editing anything.

## Turning on online play

Without this step everything works except online play and the shared table; the
app says so in its own footer instead of failing quietly.

GitHub Pages serves files and runs nothing, so two devices need a third place to
meet. Firebase Realtime Database's free tier covers this comfortably (100
simultaneous connections; you need four) and gives real presence — its
`onDisconnect()` is what makes the online dots honest when someone closes a tab.

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
   (no billing needed for the Spark plan).
2. **Build → Realtime Database → Create Database.** Pick a region; start in
   locked mode.
3. Paste [`firebase.rules.json`](firebase.rules.json) into the **Rules** tab and
   publish.
4. **Project settings → Your apps → Web** to get the config values.
5. Add them as repository **variables** (Settings → Secrets and variables →
   Actions → **Variables**), matching the names in [`.env.example`](.env.example).
6. For local development, copy `.env.example` to `.env.local` and fill it in.

### These values are not secrets

Firebase web config is public by design — it ends up in the built bundle either
way, which is why they're repository *variables* rather than secrets. Access is
governed by the database rules, not by hiding the config.

## What the codes are and aren't

The player codes and the admin role are **profile switching, not
authentication**. They ship in the JavaScript bundle and anyone who opens
devtools can read all four and flip the admin flag.

They exist to stop accidents, not attackers: they put four people in the right
seat and keep three of them from wiping the shared table by mistake. With no
auth configured, the database is writable by anyone who finds it. For four
people sharing a family game that's a reasonable trade; don't put anything
behind it you'd mind a stranger seeing.

If you outgrow that, turn on Firebase Anonymous Auth, map each uid to a player
once, and gate the rules on the uid.

**Admin** (Uzair) can wipe the ledger, strike a single game from the record, and
clear stale online marks.

## Tests

```bash
npm test
```

116 assertions across five files: the game rules, the ledger arithmetic, the AI,
the storage backends and wire format, and a jsdom pass over the real UI that
guards the six rendering invariants plus a 60-game soak.

See [CLAUDE.md](CLAUDE.md) for the invariants and why each one exists.

## Layout

```
src/data/players.js     roster, codes, roles, derived pairings
src/game/               rules, ledger, AI — all pure, all testable
src/net/                firebase, presence, match sync, storage backends
src/components/         Board, Mark, Grid, Strike, Seats, Lobby, Admin…
legacy/                 the original single-file build, kept for reference
```
