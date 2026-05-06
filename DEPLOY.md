# Deployment guide

This walks through deploying fwgin to Cloudflare Workers, using **Workers Builds** for
automatic deploys from the `main` branch.

> Prereqs: a Cloudflare account, the `wrangler` CLI authenticated locally
> (`pnpm dlx wrangler login`).

## 1. Create the D1 database

```sh
pnpm dlx wrangler d1 create fwgin
```

Wrangler prints something like:

```
[[d1_databases]]
binding = "DB"
database_name = "fwgin"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` and replace the placeholder in
[`packages/worker/wrangler.toml`](./packages/worker/wrangler.toml).

## 2. Apply the schema

Local development copy:

```sh
pnpm -F @fwgin/worker db:migrate:local
```

Production:

```sh
pnpm -F @fwgin/worker db:migrate:remote
```

## 3. Set up secrets (VAPID for Web Push, session secret)

> **Important**: every `wrangler secret put` command must be run from inside the
> `packages/worker/` directory (or with `--config packages/worker/wrangler.toml`),
> otherwise wrangler can't find the worker config and will error out.
>
> `wrangler secret put NAME` is **interactive** — it prompts you to type/paste the
> value and press Enter. The recipes below use shell pipes so you don't have to deal
> with the prompt at all.

### 3a. Generate VAPID keys

From the repo root:

```sh
pnpm gen:vapid
```

That prints something like:

```
Public key (set in wrangler.toml [vars]):
  VAPID_PUBLIC_KEY = "BHabc...truncated..."

Private key (set as a Worker secret):
  echo 'X9...truncated...' | wrangler secret put VAPID_PRIVATE_KEY
```

### 3b. Public key → wrangler.toml

Open [`packages/worker/wrangler.toml`](./packages/worker/wrangler.toml), find the `[vars]`
block, and paste the public key as the value of `VAPID_PUBLIC_KEY`:

```toml
[vars]
VAPID_PUBLIC_KEY = "BHabc...your_public_key..."
VAPID_SUBJECT = "mailto:you@example.com"
```

Commit this change — the public key is safe to commit.

### 3c. Private key → Worker secret

```sh
cd packages/worker
echo 'X9...your_private_key...' | pnpm exec wrangler secret put VAPID_PRIVATE_KEY
```

Wrangler responds with `🌀 Creating the secret for the Worker "fwgin"`.

### 3d. Session secret

The session secret signs cookies. Any 32+ bytes of randomness work; here's a one-liner:

```sh
cd packages/worker
openssl rand -base64 32 | pnpm exec wrangler secret put SESSION_SECRET
```

### 3e. Verify both secrets are set

```sh
cd packages/worker
pnpm exec wrangler secret list
```

You should see `VAPID_PRIVATE_KEY` and `SESSION_SECRET` in the output.

## 4. First manual deploy (optional but recommended)

From the repo root:

```sh
pnpm -F @fwgin/worker release
```

The `release` script (in `packages/worker/package.json`) builds the frontend then runs
`wrangler deploy`. The script is named `release` rather than `deploy` because
`pnpm deploy` is a pnpm builtin (it packages a workspace into a target directory) and
would shadow any `deploy` script — calling `pnpm -F @fwgin/worker deploy` would fail
with `ERR_PNPM_INVALID_DEPLOY_TARGET`.

The Worker is then available at `https://fwgin.<your-subdomain>.workers.dev`.

Smoke-test the deploy:

```sh
curl https://fwgin.<your-subdomain>.workers.dev/api/me -i
```

You should see a `200`, a `Set-Cookie: __Host-fwgin_session=...` header on first hit, and
a JSON body like `{"id":"u_...","displayName":"Player ..."}`.

## 5. Hook up Workers Builds for automatic deploys

In the Cloudflare dashboard:

1. **Workers & Pages → Create → Connect to Git**
2. Pick the `howardr/fwgin` repository.
3. Build configuration (these settings are **all required** — the defaults will not work
   for this monorepo, see the troubleshooting section below):
   - **Root directory**: leave blank (the repo root).
   - **Build command**: `pnpm install --frozen-lockfile && pnpm -F @fwgin/frontend build`
   - **Deploy command**: `pnpm -F @fwgin/worker exec wrangler deploy`
   - **Branch**: `main`
4. Save and trigger an initial build. Subsequent pushes to `main` will deploy automatically;
   pull requests get a preview deployment.

> **Two pitfalls the defaults / obvious-looking commands hit, and why this exact deploy
> command:**
>
> - The dashboard default `npx wrangler deploy` runs from the workspace root, where there
>   is no local wrangler in `node_modules`. `npx` then pulls the latest wrangler (v4+),
>   which has a workspace-root guard that refuses to run when it sees `pnpm-workspace.yaml`.
> - `pnpm -F @fwgin/worker deploy` triggers pnpm's builtin `deploy` command (it copies a
>   workspace into a target directory) and fails with `ERR_PNPM_INVALID_DEPLOY_TARGET`.
>   That's why our worker's deploy script is named `release`, not `deploy`.
>
> `pnpm -F @fwgin/worker exec wrangler deploy` sidesteps both: `exec` runs the binary
> directly (no builtin name collision), and the filter changes cwd to `packages/worker/`
> so the pinned wrangler v3 is used and the worker's `wrangler.toml` is found. The frontend
> dist produced by the build phase is reused — no duplicate frontend build during deploy.
> If you'd prefer the script form, `pnpm -F @fwgin/worker release` also works (it just
> rebuilds the frontend redundantly, since the build phase already produced it).

## 6. (Optional) Custom domain

In the Worker's settings under **Triggers → Custom Domains**, add your domain. The DNS
records will be managed automatically if the zone is on Cloudflare. After adding it,
update `VAPID_SUBJECT` in `wrangler.toml` to a `mailto:` you actually own — many push
services validate this.

## Cost notes (rough)

- **Workers**: 100k requests/day on the Free plan; this app makes one request per page
  navigation plus persistent WebSocket frames (which are billed as Durable Object request
  units, not Worker requests).
- **Durable Objects**: SQLite-backed DO storage uses the new pricing tier; idle hibernating
  DOs are essentially free between actions.
- **D1**: Free tier covers 5M row reads / 100k row writes per day, plenty for casual play.
- **Web Push**: Sending pushes to FCM/APNs costs nothing extra — it's just outbound `fetch()`.

## Troubleshooting

- **Workers Builds fails with `The Wrangler application detection logic has been run in
  the root of a workspace`** — your CF dashboard's **Deploy command** is still the default
  `npx wrangler deploy`. Because there's no wrangler in the root `node_modules`, `npx`
  pulls wrangler v4 from the registry, and v4 explicitly refuses to run from a workspace
  root (it sees `pnpm-workspace.yaml`). Fix: in **Workers & Pages → fwgin → Settings →
  Build → Edit configuration**, change the deploy command to
  `pnpm -F @fwgin/worker exec wrangler deploy` and re-run the build.
- **Workers Builds fails with `ERR_PNPM_INVALID_DEPLOY_TARGET  This command requires one
  parameter`** — your CF dashboard's **Deploy command** is `pnpm -F @fwgin/worker deploy`
  (or any variant of `pnpm ... deploy` without the `exec` keyword). pnpm has a builtin
  `deploy` command that takes precedence over any script named `deploy` and expects a
  target directory argument. That's why our worker's deploy script is named `release`,
  not `deploy`. Fix: change the deploy command to
  `pnpm -F @fwgin/worker exec wrangler deploy` (or `pnpm -F @fwgin/worker release` if you
  don't mind the extra frontend rebuild during deploy).
- **`Error: D1_ERROR: no such table`** — you forgot step 2. Run the migrations.
- **WebSocket connects but immediately closes** — check browser DevTools; almost always a
  cookie/auth issue. Confirm `__Host-fwgin_session` is being sent.
- **Push notification subscribe fails with `AbortError`** — the VAPID public key in
  `wrangler.toml` doesn't match the one your subscription was created against. Re-run
  `pnpm gen:vapid` and update both `[vars]` and the secret.
- **Auto-play not firing on timer expiry** — check the DO has its alarm scheduled by
  inspecting `wrangler tail` while the timer counts down. The alarm is set whenever the
  phase is `in_round`.
