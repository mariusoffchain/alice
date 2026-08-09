PRAGMA foreign_keys = OFF;

ALTER TABLE user_identities RENAME TO user_identities_email_only;

CREATE TABLE user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('email', 'passkey', 'nostr', 'account_key')),
  provider_subject TEXT NOT NULL,
  display_label TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  UNIQUE (provider, provider_subject)
) STRICT;

INSERT INTO user_identities (
  id, user_id, provider, provider_subject, display_label,
  verified_at, created_at, last_used_at
)
SELECT
  id, user_id, provider, provider_subject, display_label,
  verified_at, created_at, last_used_at
FROM user_identities_email_only;

DROP TABLE user_identities_email_only;

CREATE INDEX user_identities_user_id_idx ON user_identities(user_id);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL
    CHECK (purpose IN (
      'account_key_login',
      'account_key_link',
      'nostr_login',
      'nostr_link',
      'passkey_registration',
      'passkey_authentication'
    )),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  provider_subject TEXT,
  challenge TEXT NOT NULL,
  payload TEXT,
  expires_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX auth_challenges_expires_at_idx ON auth_challenges(expires_at);

CREATE TABLE passkey_credentials (
  credential_id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL UNIQUE
    REFERENCES user_identities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  webauthn_user_id TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  device_type TEXT NOT NULL
    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  prf_supported INTEGER NOT NULL DEFAULT 0 CHECK (prf_supported IN (0, 1)),
  transports TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
) STRICT;

CREATE INDEX passkey_credentials_user_id_idx
  ON passkey_credentials(user_id);

ALTER TABLE sessions ADD COLUMN identity_id TEXT
  REFERENCES user_identities(id) ON DELETE SET NULL;

ALTER TABLE email_challenges ADD COLUMN link_user_id TEXT
  REFERENCES users(id) ON DELETE CASCADE;

PRAGMA foreign_keys = ON;
