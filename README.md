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

Production deploys are driven by **Workers Builds** (connected to this GitHub repo).
The build step runs `pnpm install && pnpm build`, which produces:

- `packages/frontend/dist` — bundled React SPA.
- `packages/worker/dist` — bundled Worker (which serves the SPA via static asset binding).

Secrets (`SESSION_SECRET`, `VAPID_PRIVATE_KEY`) are set via the Cloudflare dashboard or
`wrangler secret put`. Public values like `VAPID_PUBLIC_KEY` go in `wrangler.toml`'s
`[vars]`. See [`packages/worker/wrangler.toml`](./packages/worker/wrangler.toml).

## License

MIT — see [LICENSE](./LICENSE).
