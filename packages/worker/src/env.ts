/**
 * Worker environment binding types. Mirror `wrangler.toml`.
 */

import type { GameDO } from './do/GameDO.js';

export interface Env {
  /** D1 database for users, sessions, lobbies, and game archives. */
  DB: D1Database;

  /** Per-game Durable Object factory. */
  GAME: DurableObjectNamespace<GameDO>;

  /** Static React SPA assets. */
  ASSETS: Fetcher;

  // Variables (public).
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;

  // Secrets.
  SESSION_SECRET: string;
  VAPID_PRIVATE_KEY: string;
}
