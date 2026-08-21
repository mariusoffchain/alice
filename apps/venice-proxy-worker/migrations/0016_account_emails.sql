-- An account now carries a reachable address.
--
-- Until now a sign-in stored only hmac(email) and a mask with the local part
-- destroyed, which made Alice structurally incapable of writing to anyone. That
-- was a deliberate property and it is deliberately being traded away: a plan
-- paid in bitcoin cannot renew itself, so its holder has to be warned before it
-- lapses, and a product with no way to reach its users can only ever apologise
-- afterwards.
--
-- The address is kept encrypted with a key the Worker holds. That defends
-- against a leaked database, an export or an old backup. It does not hide the
-- address from Alice, who decrypts it to send, and the interface says so
-- instead of implying otherwise. The HMAC lookup stays in `user_identities`:
-- signing in still matches on it, so a login never opens this table.
CREATE TABLE IF NOT EXISTS account_emails (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_ciphertext TEXT NOT NULL,
  -- Shown back to the account holder so they can tell which address is on file
  -- without the address being readable to anyone looking over their shoulder.
  email_masked TEXT NOT NULL,
  -- Whether a code was ever confirmed at this address. An address captured from
  -- a code login is verified by definition; one typed into a form is not.
  verified_at INTEGER,
  -- Transactional mail (a plan about to lapse) does not depend on this. This
  -- governs the occasional product mail, and defaults to off: silence is the
  -- honest default for something nobody asked for.
  product_updates INTEGER NOT NULL DEFAULT 0 CHECK (product_updates IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- Addresses volunteered for renewal reminders before the account carried one.
-- They were given for exactly this purpose, by people who asked to be warned,
-- so they move across rather than being thrown away and asked for again.
INSERT OR IGNORE INTO account_emails (
  user_id, email_ciphertext, email_masked, verified_at, product_updates,
  created_at, updated_at
)
SELECT user_id, email_ciphertext, email_masked, NULL, 0, created_at, updated_at
FROM billing_contacts;
