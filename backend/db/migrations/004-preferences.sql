CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  default_expiration TEXT NOT NULL DEFAULT '24h'
    CHECK (default_expiration IN ('10m', '1h', '24h', '7d', 'keep')),
  updated_at TEXT NOT NULL
) STRICT;
PRAGMA user_version = 4;
