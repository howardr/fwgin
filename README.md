# Fort Worth Gin (online)

A multiplayer, async-friendly online version of Fort Worth Gin. Hosted entirely on
Cloudflare's developer platform: a single Worker serves both the API and the React SPA,
each game lives in its own Durable Object, and persistent data lives in D1.

> Variant in use: 7-card Fort Worth Gin, 13 rounds, rotating wild card from 2 → A.
> Goal is the lowest cumulative score after 13 rounds. Full rules in [`RULES.md`](./RULES.md).

## Features

- 2 to 6 players per game.
- Async play with a configurable per-turn timer (default 24 hours).
- Live spectators via WebSockets (Durable Object hibernation).
- Browser push notifications when it is your turn.
- Anonymous handles + shareable invite links — no signup required.
- Replayable game log (deterministic seeded shuffle stored per round).

## Architecture

```
Browser (React)
   │  HTTPS / WSS
   ▼
Cloudflare Worker (`fwgin`)         single deploy unit
   ├── Static assets (React build)
   ├── REST API
   └── WS upgrade → Durable Object
                     │
                     ├── In-memory game state
                     ├── DO storage snapshot
                     └── alarm() = turn timer

Cloudflare D1 (SQLite)
   - users, sessions
   - games, game_players, game_results
   - push_subscriptions
```

The pure game logic lives in [`packages/engine`](./packages/engine) with no Cloudflare
imports, so it is unit-testable in isolation and reusable for replays.

## Workspace layout

```
packages/
  shared/    # cards, decks, Zod message schemas, shared types
  engine/    # pure game reducer + tests
  worker/    # Cloudflare Worker, Durable Object, D1 schema, REST + WS routes
  frontend/  # React SPA (Vite)
scripts/     # one-shot dev scripts (e.g. VAPID keypair generator)
```

## Local development

This repo uses [asdf](https://asdf-vm.com/) to pin Node. From a fresh clone:

```sh
asdf install                # installs Node 22 from .tool-versions
asdf exec corepack enable   # enables pnpm
pnpm install
```

Then:

```sh
pnpm dev          # runs wrangler dev (Worker + DO + local D1) and Vite dev together
pnpm test         # runs all unit tests
pnpm typecheck    # tsc --noEmit across the workspace
pnpm lint         # biome check
```

## Deployment

Step-by-step instructions live in [`DEPLOY.md`](./DEPLOY.md). Short version:

1. `pnpm dlx wrangler d1 create fwgin`, copy the `database_id` into `packages/worker/wrangler.toml`.
2. `pnpm -F @fwgin/worker db:migrate:remote` to apply the schema.
3. `pnpm gen:vapid` to mint a VAPID keypair; put the public key in `wrangler.toml` `[vars]`,
   set the private one as a Worker secret.
4. Connect the GitHub repo to **Workers Builds** in the Cloudflare dashboard.

## Project status

- ✅ Pure game engine: 31 unit tests covering melds, wild stealing, scoring, layoffs,
  going out, auto-play, and the card-conservation invariant.
- ✅ Worker + Durable Object: routes, sessions, lobby, hibernating WebSockets, alarm-driven
  auto-play, integration tests via `@cloudflare/vitest-pool-workers`.
- ✅ React SPA: landing, lobby, full table view, scoreboard, event log.
- ✅ Web Push (VAPID + aes128gcm) implemented end-to-end on Workers using only Web Crypto.
- ✅ GitHub Actions CI (lint + typecheck + test + build).

## License

MIT — see [LICENSE](./LICENSE).
