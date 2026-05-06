import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // SQLite-backed DOs don't yet play nicely with the pool's per-test isolated
        // storage. Each test file gets a fresh runtime regardless, so we don't lose much.
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
