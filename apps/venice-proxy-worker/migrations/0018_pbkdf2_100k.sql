-- The 600k iteration floor was a promise the runtime never let us keep.
--
-- Workers caps PBKDF2 at 100_000 iterations, full stop. The CHECK demanding
-- 600_000 therefore made every pbkdf2 write fail, which is how scrypt became
-- the algorithm: not chosen, cornered into. And scrypt in JavaScript costs
-- more CPU than the free plan's 10ms, so sign-in answered a bare Cloudflare
-- 1102 on bad days. Wrong password, right password, weather.
--
-- The floor drops to what the runtime allows. The password policy compensates
-- where it actually can: fifteen characters minimum, enforced at the door.
-- Existing scrypt rows stay valid and are re-derived to pbkdf2 on their next
-- successful login, so scrypt dies out one sign-in at a time.
PRAGMA foreign_keys = OFF;

CREATE TABLE password_credentials_v3 (
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
      AND iterations >= 100000
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

INSERT INTO password_credentials_v3 (
  user_id, password_hash, algorithm, iterations,
  scrypt_n, scrypt_r, scrypt_p, salt,
  created_at, updated_at, last_used_at
)
SELECT
  user_id, password_hash, algorithm, iterations,
  scrypt_n, scrypt_r, scrypt_p, salt,
  created_at, updated_at, last_used_at
FROM password_credentials;

DROP TABLE password_credentials;
ALTER TABLE password_credentials_v3 RENAME TO password_credentials;

PRAGMA foreign_keys = ON;
