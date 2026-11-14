CREATE TABLE item_files (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  storage_name TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- Physical bytes remain charged while uploading or waiting for deletion.
CREATE TABLE file_objects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  storage_name TEXT NOT NULL UNIQUE CHECK (storage_name = id || '.blob'),
  charged_bytes INTEGER NOT NULL CHECK (charged_bytes >= 0),
  state TEXT NOT NULL CHECK (state IN ('uploading', 'ready', 'deleting')),
  lease_until INTEGER,
  delete_attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX file_object_cleanup ON file_objects(state, next_retry_at, lease_until);
PRAGMA user_version = 3;
