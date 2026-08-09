PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deletion_requested', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE TABLE user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('email')),
  provider_subject TEXT NOT NULL,
  display_label TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  UNIQUE (provider, provider_subject)
) STRICT;

CREATE INDEX user_identities_user_id_idx ON user_identities(user_id);

CREATE TABLE email_challenges (
  email_lookup TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX email_challenges_expires_at_idx ON email_challenges(expires_at);

CREATE TABLE auth_rate_limits (
  bucket TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, action, window_start)
) STRICT;

CREATE INDEX auth_rate_limits_expires_at_idx ON auth_rate_limits(expires_at);

CREATE TABLE installations (
  install_id_hash TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  risk_status TEXT NOT NULL DEFAULT 'normal'
    CHECK (risk_status IN ('normal', 'review', 'blocked'))
) STRICT;

CREATE TABLE user_installations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  install_id_hash TEXT NOT NULL REFERENCES installations(install_id_hash) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, install_id_hash)
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at INTEGER NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_refresh_token_hash_idx ON sessions(refresh_token_hash);

CREATE TABLE entitlements (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free')),
  cloud_enabled INTEGER NOT NULL DEFAULT 1 CHECK (cloud_enabled IN (0, 1)),
  free_cloud_requests_limit INTEGER NOT NULL DEFAULT 21
    CHECK (free_cloud_requests_limit >= 0),
  deep_research_credits INTEGER NOT NULL DEFAULT 0
    CHECK (deep_research_credits >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE usage_counters (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  free_cloud_requests_used INTEGER NOT NULL DEFAULT 0
    CHECK (free_cloud_requests_used >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE cloud_request_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (request_type IN ('standard')),
  status TEXT NOT NULL
    CHECK (status IN ('reserved', 'confirmed', 'refunded', 'rejected')),
  units INTEGER NOT NULL DEFAULT 0 CHECK (units IN (0, 1)),
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  refunded_at INTEGER,
  failure_code TEXT,
  UNIQUE (user_id, idempotency_key)
) STRICT;

CREATE INDEX cloud_request_ledger_user_created_idx
  ON cloud_request_ledger(user_id, created_at);
