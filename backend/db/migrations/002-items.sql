CREATE TABLE items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('text', 'link', 'file')),
  text_content TEXT,
  is_kept INTEGER NOT NULL DEFAULT 0 CHECK (is_kept IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  source_device TEXT,
  submission_id TEXT NOT NULL,
  UNIQUE (user_id, submission_id)
) STRICT;

CREATE INDEX items_owner_created ON items(user_id, created_at DESC, id DESC);
CREATE INDEX items_owner_retention ON items(user_id, is_kept, created_at DESC, id DESC);
CREATE INDEX items_expiration ON items(expires_at) WHERE expires_at IS NOT NULL;

PRAGMA user_version = 2;
