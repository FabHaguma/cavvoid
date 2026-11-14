CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK (id = 'owner'),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

PRAGMA user_version = 1;
