-- Paid plans, Bitcoin invoices and byte-metered quotas.
--
-- Alice relays end-to-end encrypted traffic and never buffers a response, so
-- the Worker cannot read `usage.prompt_tokens` from Venice. What it can do,
-- honestly and without inspecting anything, is count the bytes that pass
-- through. Ciphertext length tracks plaintext length, so bytes are a faithful
-- proxy for tokens once multiplied by a calibration ratio held in config.
--
-- Quotas are therefore stored in bytes. Tokens are a presentation unit,
-- derived at display time; they are never the unit of record.

PRAGMA foreign_keys = OFF;

-- 1. Entitlements gain a paid plan, an expiry and byte budgets.
--
-- `plan` was CHECK-constrained to 'free' alone, so the table has to be
-- rebuilt rather than altered. An expired paid plan keeps its row: `plan`
-- records what was bought, `plan_expires_at` decides whether it still grants
-- anything. Reverting the column to 'free' on expiry would destroy the
-- history of what the account used to hold.
CREATE TABLE entitlements_v2 (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'cloud', 'cloud_plus')),
  plan_expires_at INTEGER,
  cloud_enabled INTEGER NOT NULL DEFAULT 1 CHECK (cloud_enabled IN (0, 1)),
  free_cloud_requests_limit INTEGER NOT NULL DEFAULT 21
    CHECK (free_cloud_requests_limit >= 0),
  -- Monthly allowance of the paid plan, in bytes of encrypted payload.
  -- Zero on a free account, which is metered in requests instead.
  input_bytes_limit INTEGER NOT NULL DEFAULT 0 CHECK (input_bytes_limit >= 0),
  output_bytes_limit INTEGER NOT NULL DEFAULT 0 CHECK (output_bytes_limit >= 0),
  deep_research_credits INTEGER NOT NULL DEFAULT 0
    CHECK (deep_research_credits >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- A paid plan without an expiry would never end; a free plan with one would
  -- suggest the free tier lapses, which it does not.
  CHECK (
    (plan = 'free' AND plan_expires_at IS NULL)
    OR (plan <> 'free' AND plan_expires_at IS NOT NULL)
  )
) STRICT;

INSERT INTO entitlements_v2 (
  user_id, plan, plan_expires_at, cloud_enabled, free_cloud_requests_limit,
  input_bytes_limit, output_bytes_limit, deep_research_credits,
  created_at, updated_at
)
SELECT
  user_id, plan, NULL, cloud_enabled, free_cloud_requests_limit,
  0, 0, deep_research_credits, created_at, updated_at
FROM entitlements;

DROP TABLE entitlements;
ALTER TABLE entitlements_v2 RENAME TO entitlements;

CREATE INDEX entitlements_plan_expires_at_idx
  ON entitlements(plan_expires_at)
  WHERE plan_expires_at IS NOT NULL;

-- 2. Usage counters gain the byte meters and a rolling period.
--
-- The paid allowance renews every 30 days from `period_started_at`, which is
-- set when the plan first starts. Someone who prepays three months therefore
-- gets three renewals with no extra bookkeeping.
ALTER TABLE usage_counters ADD COLUMN input_bytes_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_counters ADD COLUMN output_bytes_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_counters ADD COLUMN period_started_at INTEGER;

-- 3. The request ledger records bytes alongside the free-request unit.
--
-- `units` stays the free-plan counter. `reserved_output_bytes` is the
-- worst-case charge taken up front, since output size is only known once the
-- stream ends; `output_bytes` replaces it at settlement. A request that dies
-- mid-stream keeps the reservation, which is the conservative direction.
CREATE TABLE cloud_request_ledger_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (request_type IN ('standard', 'deep_research')),
  status TEXT NOT NULL
    CHECK (status IN ('reserved', 'confirmed', 'refunded', 'rejected')),
  units INTEGER NOT NULL DEFAULT 0 CHECK (units IN (0, 1)),
  input_bytes INTEGER NOT NULL DEFAULT 0 CHECK (input_bytes >= 0),
  reserved_output_bytes INTEGER NOT NULL DEFAULT 0
    CHECK (reserved_output_bytes >= 0),
  output_bytes INTEGER NOT NULL DEFAULT 0 CHECK (output_bytes >= 0),
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  refunded_at INTEGER,
  failure_code TEXT,
  UNIQUE (user_id, idempotency_key)
) STRICT;

INSERT INTO cloud_request_ledger_v2 (
  id, user_id, idempotency_key, request_type, status, units,
  input_bytes, reserved_output_bytes, output_bytes,
  created_at, confirmed_at, refunded_at, failure_code
)
SELECT
  id, user_id, idempotency_key, request_type, status, units,
  0, 0, 0, created_at, confirmed_at, refunded_at, failure_code
FROM cloud_request_ledger;

DROP TABLE cloud_request_ledger;
ALTER TABLE cloud_request_ledger_v2 RENAME TO cloud_request_ledger;

CREATE INDEX cloud_request_ledger_user_created_idx
  ON cloud_request_ledger(user_id, created_at);

-- 4. Invoices.
--
-- One row per BTCPay invoice. No payment detail, no address, no transaction
-- id: the payment rail knows those, and Alice has no use for them. `months`
-- is what the invoice buys, added to the existing expiry rather than
-- replacing it, so prepaying never destroys time already paid for.
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'btcpay' CHECK (provider IN ('btcpay')),
  provider_invoice_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('cloud', 'cloud_plus')),
  months INTEGER NOT NULL CHECK (months >= 1 AND months <= 24),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'invalid')),
  -- Set exactly once, when the paid webhook credits the account. Its presence
  -- is what makes crediting idempotent under webhook retries.
  credited_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX invoices_user_created_idx ON invoices(user_id, created_at);
CREATE INDEX invoices_status_idx ON invoices(status);

-- 5. Billing contacts.
--
-- Alice deliberately cannot email a user who has not just asked her to: sign-in
-- stores only hmac(email) and a masked label whose local part is destroyed. A
-- renewal reminder needs a real address, so paying accounts may add one here.
--
-- It is encrypted with a key held as a Wrangler secret, never in D1, and is
-- decrypted only by the reminder cron. That protects the address against a
-- database leak or a stray backup, not against Alice's own infrastructure, and
-- the interface says exactly that rather than promising more. An alias works
-- fine and the interface says so too.
CREATE TABLE billing_contacts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- AES-GCM ciphertext, base64url, nonce prefixed. Never a plain address.
  email_ciphertext TEXT NOT NULL,
  -- Shown in the account screen so the user can tell which address is on file
  -- without Alice having to decrypt anything to display it.
  email_masked TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- 6. Expiry reminders.
--
-- Bitcoin payments cannot be direct-debited, so an expiring plan needs a
-- nudge. One row per reminder actually sent, keyed so the hourly cron can
-- never send the same one twice, however often it runs.
CREATE TABLE billing_reminders (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The expiry this reminder was about. A renewal moves the expiry, which
  -- makes the next cycle's reminders new rows rather than duplicates.
  plan_expires_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('t_minus_3', 'expiry_day')),
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, plan_expires_at, kind)
) STRICT;

CREATE INDEX billing_reminders_sent_at_idx ON billing_reminders(sent_at);

PRAGMA foreign_keys = ON;
