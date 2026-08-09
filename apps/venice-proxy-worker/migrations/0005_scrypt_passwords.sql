PRAGMA foreign_keys = OFF;

CREATE TABLE password_credentials_v2 (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm IN ('pbkdf2-sha256', 'scrypt')),
  iterations INTEGER,
  scrypt_n INTEGER,
  scrypt_r INTEGER,
  scrypt_p INTEGER,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  CHECK (
    (
      algorithm = 'pbkdf2-sha256'
      AND iterations >= 600000
      AND scrypt_n IS NULL
      AND scrypt_r IS NULL
      AND scrypt_p IS NULL
    )
    OR
    (
      algorithm = 'scrypt'
      AND iterations IS NULL
      AND scrypt_n >= 32768
      AND scrypt_r >= 8
      AND scrypt_p >= 1
    )
  )
) STRICT;

INSERT INTO password_credentials_v2 (
  user_id, password_hash, algorithm, iterations,
  scrypt_n, scrypt_r, scrypt_p, salt,
  created_at, updated_at, last_used_at
)
SELECT
  user_id, password_hash, algorithm, iterations,
  NULL, NULL, NULL, salt,
  created_at, updated_at, last_used_at
FROM password_credentials;

DROP TABLE password_credentials;
ALTER TABLE password_credentials_v2 RENAME TO password_credentials;

PRAGMA foreign_keys = ON;
