PRAGMA foreign_keys = ON;

-- Admin role. A row here grants Alice-staff dashboard access to the account
-- with this user_id. There is intentionally only one role today: the CHECK
-- constraint keeps that explicit instead of implicit.
CREATE TABLE admin_users (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at INTEGER NOT NULL
) STRICT;

-- Append-only audit trail for admin actions. `metadata` is a small JSON blob
-- of operational facts only (reason strings, before/after numbers, counts) —
-- application code must never put secrets, tokens, prompts, AI responses, or
-- wallet data in it. `target_support_id` snapshots the username or masked
-- email at the time of the action so the trail stays readable even after a
-- hard delete, independent of `target_user_id`.
CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'admin_login',
    'admin_bootstrap',
    'view_account',
    'suspend_account',
    'reactivate_account',
    'adjust_credits',
    'delete_account',
    'promote_admin',
    'demote_admin',
    'create_promo',
    'disable_promo'
  )),
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_support_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX admin_audit_log_created_at_idx ON admin_audit_log(created_at);
CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log(actor_user_id);

-- Technical telemetry only: a status code and a coarse category, nothing
-- else. No prompt, no response, no IP, no header, no free-text message.
-- user_id is nullable and is only ever set from an already-authenticated
-- session (never derived from IP or install id), so an account's own error
-- history can be shown to admins without adding new tracking.
CREATE TABLE technical_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('auth', 'email', 'venice')),
  code TEXT NOT NULL,
  status INTEGER NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX technical_events_created_at_idx ON technical_events(created_at);
CREATE INDEX technical_events_user_id_idx ON technical_events(user_id);

-- Promo codes are a manual operator tool for granting extra free Private
-- Cloud requests, not a payment system.
CREATE TABLE promo_codes (
  code TEXT PRIMARY KEY,
  credits INTEGER NOT NULL CHECK (credits > 0 AND credits <= 10000),
  max_redemptions INTEGER NOT NULL CHECK (max_redemptions > 0),
  redemptions_count INTEGER NOT NULL DEFAULT 0
    CHECK (redemptions_count >= 0),
  expires_at INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
) STRICT;

CREATE TABLE promo_redemptions (
  code TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
) STRICT;
