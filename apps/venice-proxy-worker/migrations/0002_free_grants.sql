PRAGMA foreign_keys = ON;

CREATE TABLE free_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  install_id_hash TEXT UNIQUE REFERENCES installations(install_id_hash) ON DELETE RESTRICT,
  request_limit INTEGER NOT NULL DEFAULT 21 CHECK (request_limit = 21),
  granted_at INTEGER NOT NULL
) STRICT;

CREATE INDEX free_grants_install_id_hash_idx
  ON free_grants(install_id_hash);

-- Preserve an existing beta account's allowance while recording the oldest
-- installation that received it. Accounts without an installation are
-- grandfathered with a NULL installation and cannot create a new grant.
INSERT OR IGNORE INTO free_grants (
  id, user_id, install_id_hash, request_limit, granted_at
)
SELECT
  'legacy-' || entitlements.user_id,
  entitlements.user_id,
  (
    SELECT user_installations.install_id_hash
    FROM user_installations
    WHERE user_installations.user_id = entitlements.user_id
    ORDER BY user_installations.linked_at ASC
    LIMIT 1
  ),
  21,
  entitlements.created_at
FROM entitlements
WHERE entitlements.free_cloud_requests_limit > 0;

UPDATE entitlements
SET free_cloud_requests_limit = CASE
  WHEN EXISTS (
    SELECT 1 FROM free_grants
    WHERE free_grants.user_id = entitlements.user_id
  ) THEN 21
  ELSE 0
END;
