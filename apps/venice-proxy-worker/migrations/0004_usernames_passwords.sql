PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN username_updated_at INTEGER;

CREATE UNIQUE INDEX users_username_unique_idx
  ON users(username)
  WHERE username IS NOT NULL;

CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm IN ('pbkdf2-sha256')),
  iterations INTEGER NOT NULL CHECK (iterations >= 600000),
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
) STRICT;

CREATE TABLE username_history (
  username TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  released_at INTEGER,
  reserved_until INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX username_history_user_id_idx
  ON username_history(user_id);
