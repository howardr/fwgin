-- Initial schema for fwgin.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS games (
  id              TEXT PRIMARY KEY,
  host_user_id    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('lobby','in_progress','completed','abandoned')),
  config_json     TEXT NOT NULL,
  invite_code     TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  completed_at    INTEGER,
  winner_user_id  TEXT
);
CREATE INDEX IF NOT EXISTS games_status_created ON games(status, created_at);
CREATE INDEX IF NOT EXISTS games_invite ON games(invite_code);

CREATE TABLE IF NOT EXISTS game_players (
  game_id       TEXT NOT NULL REFERENCES games(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  seat          INTEGER NOT NULL,
  display_name  TEXT NOT NULL,
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS game_players_user ON game_players(user_id);

CREATE TABLE IF NOT EXISTS game_results (
  game_id       TEXT PRIMARY KEY REFERENCES games(id),
  state_json    TEXT NOT NULL,
  scores_json   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subscriptions(user_id);
