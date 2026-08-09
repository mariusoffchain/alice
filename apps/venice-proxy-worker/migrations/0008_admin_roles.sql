PRAGMA foreign_keys = OFF;

-- Split the single admin role into two tiers. SQLite cannot alter a CHECK
-- constraint in place, so the table is rebuilt, same pattern as migration
-- 0005.
--
--   admin   - full operator access, including destructive actions
--   support - read-only. Can see the overview, search accounts, open an
--             account sheet and read the audit log, but cannot suspend,
--             adjust credits, delete, manage promo codes or change roles.
CREATE TABLE admin_users_v2 (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'support')),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at INTEGER NOT NULL
) STRICT;

INSERT INTO admin_users_v2 (user_id, role, granted_by, granted_at)
SELECT user_id, role, granted_by, granted_at FROM admin_users;

DROP TABLE admin_users;
ALTER TABLE admin_users_v2 RENAME TO admin_users;

-- Denied admin attempts are worth seeing, so a probe against the dashboard
-- is visible rather than silent. Only the actor and the action are recorded.
CREATE TABLE admin_access_denials (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('not_admin', 'insufficient_role', 'reauth_failed')),
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX admin_access_denials_created_at_idx
  ON admin_access_denials(created_at);

PRAGMA foreign_keys = ON;
