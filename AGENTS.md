# AGENTS.md — fwgin project context

This file is the canonical context for any AI agent working on this codebase. Read it
before doing anything substantial; it captures decisions that aren't obvious from the
code alone, plus operational gotchas that have already cost time once.

---

## What this is

**fwgin** is an online, async-friendly multiplayer version of **Fort Worth Gin** (a
gin-rummy variant). It runs entirely on Cloudflare's developer platform:

- **Workers** for the API + a single Worker that also serves the React SPA via
  static asset bindings.
- **Durable Objects** (one per game) for live game state with hibernating WebSockets.
- **D1** (SQLite) for users, sessions, lobbies, and game archives.
- **Web Push** for "it's your turn" notifications.

Game rules are documented in [`RULES.md`](./RULES.md) — that file is the authoritative
spec for the engine. Before making any rule change, update `RULES.md` first, then code,
then tests.

- GitHub: `git@github.com:howardr/fwgin.git`
- Production URL: `https://fwgin.howardr.workers.dev`
- Cloudflare account: `howardr@gmail.com` (account id `dd262e7d934a73870877df3c0edc5df5`)

## Repo layout

```
packages/
  shared/    # types, Zod message schemas, cards/decks/RNG, meld validation, scoring
  engine/    # pure game reducer + tests; NO Cloudflare imports
  worker/    # Cloudflare Worker, GameDO, D1 schema, REST + WS routes
  frontend/  # React + Vite SPA (hash router, custom WS hook)
scripts/     # gen-vapid.mjs and other one-off scripts
.github/workflows/ci.yml   # lint + typecheck + test + build on every push/PR
RULES.md                    # canonical Fort Worth Gin rules
DEPLOY.md                   # step-by-step Cloudflare deployment guide
```

The **engine package is pure** — keep it that way. It has no `cloudflare:workers`,
no `D1Database`, no Web APIs beyond what Node 22 provides. That's what makes it
trivially unit-testable and reusable for replays.

## Tooling

This machine uses **asdf** for runtime management. **Always prefix Node-runtime
commands with `asdf exec`**:

- `asdf exec pnpm install`
- `asdf exec pnpm test`
- `asdf exec pnpm exec wrangler ...`

Direct `pnpm` may resolve to a different shim. Check `asdf current` if anything
looks confused.

Runtimes pinned in `.tool-versions`: Node 22.21.0. Package manager pinned in
`package.json` `packageManager` field: pnpm 10.3.0.

### Common commands

```sh
asdf exec pnpm install                # install deps
asdf exec pnpm test                   # run all unit + DO integration tests
asdf exec pnpm typecheck              # tsc --noEmit across all 4 packages
asdf exec pnpm lint                   # biome check .
asdf exec pnpm exec biome check --write .   # auto-fix lint + format
asdf exec pnpm -F @fwgin/engine test:watch  # watch tests for the engine only

# Frontend dev
asdf exec pnpm -F @fwgin/frontend dev
# Worker dev (run separately; vite proxies /api/* + WS to it)
asdf exec pnpm -F @fwgin/worker dev

# Build
asdf exec pnpm -F @fwgin/frontend build     # produces packages/frontend/dist
# Worker bundle (dry-run)
cd packages/worker && asdf exec pnpm exec wrangler deploy --dry-run --outdir /tmp/x

# Deploy (do not use `pnpm deploy` — it collides with pnpm's builtin)
cd packages/worker && asdf exec pnpm exec wrangler deploy
```

## Critical invariants the engine maintains

These are checked in tests; do not break them:

1. **Card conservation**: `stock + discard + sum(hands) + sum(meld.cards) = 52` at all
   times. There is a test for this in `packages/engine/tests/engine.test.ts`.
2. **Hidden info stays hidden**: clients never receive raw `GameState`. Always go
   through `viewForPlayer(state, userId)` or `viewForSpectator(state)` from
   `packages/engine/src/view.ts` before broadcasting.
3. **Deterministic shuffle**: each round has a fresh hex seed stored on
   `state.rngSeed` and shuffles run via `rngFromSeed(seed)`. Never call
   `Math.random()` in the engine — use the seeded PRNG.
4. **Server validates all actions**: client UI may pre-validate for snappy feedback,
   but the DO's reducer is the source of truth. Every action returns
   `{ ok: true } | { ok: false, code, message }`.
5. **Wild stealing**: only on the stealer's turn, before they draw. The natural
   card holder may surrender the exact represented card to take the wild.
6. **Layoff onto opponents**: only legal once the player has laid at least one of
   their own melds in the *current* round (`hasOwnMeldThisRound` check).
7. **Going out**: hand must be empty AND the player has at least one own meld this
   round. Going out on turn 1 IS legal (instant gin / "snapper").
8. **One wild per meld**: enforced in `validateMeld`. Multi-wild melds are rejected
   for clarity.

## Game-rule details that are easy to forget

- **Wild rank rotates per round**: round 1 = 2, round 2 = 3, ..., round 12 = K,
  round 13 = A. See `wildRankForRound()` in `packages/shared/src/cards.ts`.
- **Aces mode is configurable**: `low` (A-2-3 only), `high` (Q-K-A only, default),
  or `either` (both A-2-3 and Q-K-A, but never wraparound K-A-2).
- **Deadwood scoring**: A=1 in `low` mode, A=13 in `high`/`either`. T/J/Q/K = 10.
  2-9 = face. Wild rank still in hand at round end = **25 points**.
- **Auto-play on timer expiry**: `draw_stock` then immediately `discard` that same
  card. No melds, no steal. Logged as a single `auto_played` event.
- **Stock reshuffle**: when stock empties, take all but the top discard, shuffle
  with a *fresh* seed (so the new order can't be derived from the round seed),
  place as new stock. Top discard remains.
- **Tiebreaker**: lowest cumulative score after 13 rounds wins. Tiebreaker is
  fewest non-zero rounds. If still tied, shared win.

## How a turn flows through the system

1. Client sends a `ClientMsg` (Zod-validated in `packages/shared/src/messages.ts`)
   over the WS to the DO.
2. DO's `webSocketMessage` parses, calls `toAction(msg, userId)` to get an engine
   `Action`, then calls `apply(state, action)`.
3. If the engine rejects the action, DO sends an `error` frame back to that single
   socket. State is unchanged.
4. If accepted, DO calls `afterAction(before)`:
   - `scheduleAlarm()` — sets `state.storage.setAlarm(turnDeadline)` while phase
     is `in_round` or `awaiting_upcard`; otherwise deletes the alarm.
   - `persist()` — writes the full `GameState` to DO storage under key `state`.
   - `broadcast()` — sends a redacted view to every connected WebSocket. Role
     (player/spectator) is recomputed from the *current* `game.players` so a
     visitor who just joined gets promoted automatically.
   - If turn-seat changed, fires Web Push to the new active player via
     `notifyPlayerTurn` (using `ctx.waitUntil` so action latency isn't blocked).

`alarm()` calls into the same `apply` + `afterAction` path with `AUTO_PLAY`.

## Cloudflare resources

D1 database id is committed in `packages/worker/wrangler.toml`:

```
database_id = "66ee6498-770d-4e77-850a-2e4466bbfaf1"
```

Schema is in `packages/worker/migrations/0001_init.sql`. To apply changes:

```sh
asdf exec pnpm -F @fwgin/worker db:migrate:local    # local dev
asdf exec pnpm -F @fwgin/worker db:migrate:remote   # production
```

Secrets currently set on the production worker:

- `SESSION_SECRET` — random 32-byte base64 used to sign session cookies.
- `VAPID_PRIVATE_KEY` — base64url JWK `d` for Web Push (matches public key in
  `wrangler.toml` `[vars]`).

### Things that have been confusing in the past

- **`wrangler secret put NAME` is interactive** by default. Pipe via stdin to
  avoid the prompt: `echo 'value' | wrangler secret put NAME` or
  `openssl rand -base64 32 | wrangler secret put SESSION_SECRET`.
- Run `wrangler ...` commands from `packages/worker/` (or pass `--config`),
  otherwise wrangler can't find the worker config.
- `wrangler d1 list` shows a stale `num_tables` count. Use
  `wrangler d1 execute fwgin --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
  to check the actual schema.
- `pnpm deploy` is a pnpm builtin and conflicts with our worker `deploy` script.
  Always use `pnpm exec wrangler deploy` instead.

## Code style conventions

- TypeScript everywhere, strict mode + `noUncheckedIndexedAccess`. Use non-null
  assertions (`!`) sparingly and only where the invariant is clear.
- **Biome** for lint + format. Single quotes, semicolons, trailing commas, 100-col
  line length. Run `asdf exec pnpm exec biome check --write .` before committing.
- **No emojis in source files** unless the user explicitly asks.
- Use `import type { ... }` for type-only imports (Biome warns about this).
- Imports are organized by Biome (`organizeImports`); don't fight the tool.
- Prefer named exports, avoid default exports.
- Pure functions and small modules. The engine is the gold standard — copy that
  style.

## Testing conventions

- All `*.test.ts` files run under **Vitest**.
- Engine tests live in `packages/engine/tests/`. Add a new test file per domain
  area; helpers go in `tests/helpers.ts`.
- Worker DO integration tests use `@cloudflare/vitest-pool-workers` and live in
  `packages/worker/test/`. **Important**: the pool config disables
  `isolatedStorage` because SQLite-backed DOs don't yet play nicely with it.
  Don't re-enable it without testing carefully.
- When fixing a bug, write the test that reproduces it first, then the fix.
- The card-conservation invariant test is the canary — if you make engine changes
  that don't preserve the deck size, that test will catch you.

## Frontend conventions

- Hash-based routing (`#/`, `#/games/:id`). No router library — just
  `window.location.hash`. Keep it simple.
- WebSocket connection lives in `useGameSocket(gameId)` — owns auto-reconnect with
  exponential backoff (250ms → 5s cap).
- `view` from the WS is the source of truth for live state. The lobby's REST
  fetch is just the initial seed; subsequent updates come over the WS and are
  merged back into local state.
- All API calls go through `src/lib/api.ts` with `credentials: 'include'` so the
  session cookie is sent.
- CSS is hand-rolled in `src/styles.css` with CSS custom properties for the dark
  theme. No Tailwind in this repo.

## TypeScript / Workers gotchas

- `@cloudflare/workers-types` uses `$public` instead of `public` for ECDH derive
  params (TS reserved-word workaround). The runtime takes the standard `public`.
  Cast with `as any` (see `packages/worker/src/push/send.ts`).
- `crypto.subtle.exportKey('raw', ...)` is typed as `ArrayBuffer | JsonWebKey` in
  workers-types. Cast to `ArrayBuffer` before passing to `new Uint8Array(...)`.
- `WebSocketPair` returns an object with index access (`pair[0]` and `pair[1]`).
  Don't destructure with `Object.values()` — TS thinks they could be undefined.
- The `DurableObject` base class from `cloudflare:workers` exposes `this.ctx`
  (DurableObjectState) and `this.env`. Don't shadow these with same-named fields.
- WS handlers in a hibernating DO need `override` modifiers because they override
  the base class methods.

## Engine extensibility notes

`GameState._turnState` is a small ephemeral object attached via a module
augmentation in `packages/engine/src/engine.ts`. It tracks whether the active
player has drawn this turn (used by `STEAL_WILD` validation). The augmentation
extends the `@fwgin/shared` `GameState` interface — keep that pattern if you
need to add more turn-scoped state.

When adding a new action:

1. Add it to `Action` union in `packages/engine/src/actions.ts`.
2. Implement the handler in `engine.ts`'s `dispatch` switch + a private function.
3. If it's player-initiated, add the message variant to `ClientMsg` in
   `packages/shared/src/messages.ts` and the `toAction` mapper in
   `packages/worker/src/do/GameDO.ts`.
4. Add unit tests covering both happy path and rejection cases.
5. If it's a UI-visible action, surface it in `Game.tsx`.

## Project status snapshot (update as things change)

- ✅ Pure engine + 31 tests; 45 shared tests; 2 DO tests. Total 78 tests passing.
- ✅ Worker + DO + D1 deployed at `fwgin.howardr.workers.dev`.
- ✅ Frontend MVP: landing, lobby (with live-update + auto-join), full table view,
  scoreboard, event log, chat panel, game-over banner.
- ✅ Web Push via VAPID + aes128gcm, all in Web Crypto.
- ✅ GitHub Actions CI on every push/PR.
- ⏸️ No Playwright e2e suite yet (highest-value next addition).
- ⏸️ Wild-card "represents what?" is collected via `window.prompt`; needs an
   inline picker for a nicer UX.
- ⏸️ No round-end summary modal — round transitions happen instantly (the engine
   immediately deals the next round). A brief pause + summary screen would help.

## Where to look first for common tasks

| Task | Files |
|------|-------|
| Change a game rule | `RULES.md` first, then `packages/engine/`, then tests |
| Fix a meld validation bug | `packages/shared/src/meld.ts` + its tests |
| Add a new event log entry | `packages/shared/src/types.ts` (`GameEvent`), then where you log it, then `describeEvent` in `packages/frontend/src/screens/Game.tsx` |
| Add a new API endpoint | `packages/worker/src/routes/` + register in `src/index.ts` |
| Change the lobby UI | `packages/frontend/src/screens/Game.tsx` (`Lobby` component) |
| Touch the WebSocket protocol | `packages/shared/src/messages.ts` (Zod) is the contract |
| Add a Worker secret | Document in `DEPLOY.md`, set via `wrangler secret put` |
| Modify D1 schema | New migration in `packages/worker/migrations/`, then run both `:local` and `:remote` migrate scripts |

## Commit / git conventions

- The user's git remote is `git@github.com:howardr/fwgin.git`, branch `main`.
- Commit messages: short imperative subject ("Add X", "Fix Y"), followed by a
  blank line and a body that explains the *why*. Reference test counts and
  notable architectural choices when relevant. Bullet lists in the body are fine.
- **Don't commit unless the user asks**. The user has explicitly enabled commits
  for milestone work in this repo, but do not auto-commit speculative changes.
- Never commit secrets. `.env`, the VAPID private key, and `SESSION_SECRET` go
  through `wrangler secret put`, not source control.

## Open questions / decisions to revisit

- **Wild stealing of an in-meld wild that has already been laid off in the same
  meld**: the current rule says "1 steal per turn" and "before draw". Edge cases
  with multi-suit ambiguity in sets (`7♣ 7♠ W` representing 7♥ vs 7♦) are
  resolved by requiring the laying player to declare the represented suit.
  Confirmed working in tests.
- **Round-end auto-deal vs manual continue**: currently the engine auto-deals
  the next round inside `finishRound`. If we ever want a "tap to continue" UX,
  introduce a `round_over` phase that requires a `START_ROUND` action.
- **Reconnection mid-round** is supported (the WS reconnects automatically and
  re-syncs from a fresh state broadcast), but there's no explicit UX hint — the
  status dot in the table header is the only indicator.
