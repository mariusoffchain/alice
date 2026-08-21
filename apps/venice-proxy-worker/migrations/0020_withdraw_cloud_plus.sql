-- Cloud+ leaves the schema, not only the price list.
--
-- It sold Deep Research and could not deliver it: the relay never decrypts, so
-- Venice cannot read the question it would have to search for. The plan was
-- withdrawn from sale in the code first; this removes it from the data, so no
-- row can name a plan the catalogue no longer defines. The webhook resolves an
-- invoice's plan against that catalogue, and a settled invoice naming a
-- vanished plan would be a crash waiting for a redelivery.
--
-- One entitlement and one invoice exist, both from the same test purchase made
-- by the operator against their own store. Nothing is owed to anyone.

-- The entitlement returns to free. The paired CHECK on the table demands a null
-- expiry for a free plan, so both move together or neither does.
UPDATE entitlements
SET plan = 'free',
    plan_expires_at = NULL,
    input_bytes_limit = 0,
    output_bytes_limit = 0,
    deep_research_limit = 0,
    updated_at = unixepoch() * 1000
WHERE plan = 'cloud_plus';

-- Deleting a paid invoice would normally be indefensible: a billing ledger is
-- a record, and records are not rewritten because the product changed. This one
-- is the operator's own test payment to their own store, for a plan that never
-- existed for anyone else. Keeping it would mean keeping 'cloud_plus' legal in
-- the schema forever to describe a single row nobody will ever read.
DELETE FROM invoices WHERE plan = 'cloud_plus';

PRAGMA foreign_keys = OFF;

CREATE TABLE entitlements_v2 (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'cloud')),
  plan_expires_at INTEGER,
  cloud_enabled INTEGER NOT NULL DEFAULT 1 CHECK (cloud_enabled IN (0, 1)),
  free_cloud_requests_limit INTEGER NOT NULL DEFAULT 21
    CHECK (free_cloud_requests_limit >= 0),
  input_bytes_limit INTEGER NOT NULL DEFAULT 0 CHECK (input_bytes_limit >= 0),
  output_bytes_limit INTEGER NOT NULL DEFAULT 0 CHECK (output_bytes_limit >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (plan = 'free' AND plan_expires_at IS NULL)
    OR (plan <> 'free' AND plan_expires_at IS NOT NULL)
  )
) STRICT;

-- deep_research_limit is not carried across. Nothing reads it any more, and a
-- column no code touches is a question every future reader has to answer twice:
-- once to find what writes it, once to find that nothing does.
INSERT INTO entitlements_v2 (
  user_id, plan, plan_expires_at, cloud_enabled, free_cloud_requests_limit,
  input_bytes_limit, output_bytes_limit,
  created_at, updated_at
)
SELECT
  user_id, plan, plan_expires_at, cloud_enabled, free_cloud_requests_limit,
  input_bytes_limit, output_bytes_limit,
  created_at, updated_at
FROM entitlements;

DROP TABLE entitlements;
ALTER TABLE entitlements_v2 RENAME TO entitlements;

-- Rebuilding a table takes its indexes with it. The expiry sweep and the
-- renewal reminders both scan on this one.
CREATE INDEX entitlements_plan_expires_at_idx
  ON entitlements(plan_expires_at)
  WHERE plan_expires_at IS NOT NULL;

CREATE TABLE invoices_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'btcpay' CHECK (provider IN ('btcpay')),
  provider_invoice_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('cloud')),
  months INTEGER NOT NULL CHECK (months >= 1 AND months <= 24),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  amount_sats INTEGER,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'invalid')),
  credited_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO invoices_v2 (
  id, user_id, provider, provider_invoice_id, plan, months,
  amount_cents, amount_sats, currency, status, credited_at,
  created_at, updated_at
)
SELECT
  id, user_id, provider, provider_invoice_id, plan, months,
  amount_cents, amount_sats, currency, status, credited_at,
  created_at, updated_at
FROM invoices;

DROP TABLE invoices;
ALTER TABLE invoices_v2 RENAME TO invoices;

CREATE INDEX invoices_user_created_idx ON invoices(user_id, created_at);
CREATE INDEX invoices_status_idx ON invoices(status);

-- The counter that paired with the limit, for the same reason.
CREATE TABLE usage_counters_v2 (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  free_cloud_requests_used INTEGER NOT NULL DEFAULT 0
    CHECK (free_cloud_requests_used >= 0),
  input_bytes_used INTEGER NOT NULL DEFAULT 0,
  output_bytes_used INTEGER NOT NULL DEFAULT 0,
  period_started_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO usage_counters_v2 (
  user_id, free_cloud_requests_used, input_bytes_used, output_bytes_used,
  period_started_at, version, updated_at
)
SELECT
  user_id, free_cloud_requests_used, input_bytes_used, output_bytes_used,
  period_started_at, version, updated_at
FROM usage_counters;

DROP TABLE usage_counters;
ALTER TABLE usage_counters_v2 RENAME TO usage_counters;

PRAGMA foreign_keys = ON;
