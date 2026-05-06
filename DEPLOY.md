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
pnpm -F @fwgin/frontend build
pnpm -F @fwgin/worker deploy
```

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
3. Build configuration:
   - **Root directory**: leave blank (the repo root).
   - **Build command**: `pnpm install --frozen-lockfile && pnpm -F @fwgin/frontend build`
   - **Deploy command**: `pnpm -F @fwgin/worker deploy`
   - **Branch**: `main`
4. Save and trigger an initial build. Subsequent pushes to `main` will deploy automatically;
   pull requests get a preview deployment.

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

- **`Error: D1_ERROR: no such table`** — you forgot step 2. Run the migrations.
- **WebSocket connects but immediately closes** — check browser DevTools; almost always a
  cookie/auth issue. Confirm `__Host-fwgin_session` is being sent.
- **Push notification subscribe fails with `AbortError`** — the VAPID public key in
  `wrangler.toml` doesn't match the one your subscription was created against. Re-run
  `pnpm gen:vapid` and update both `[vars]` and the secret.
- **Auto-play not firing on timer expiry** — check the DO has its alarm scheduled by
  inspecting `wrangler tail` while the timer counts down. The alarm is set whenever the
  phase is `in_round` or `awaiting_upcard`.
