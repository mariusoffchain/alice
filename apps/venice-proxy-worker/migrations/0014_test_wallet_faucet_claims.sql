-- One faucet claim per learner, for life.
--
-- The learner is the installation: the same identifier Alice already uses for
-- installations, stable across IP changes and network switches, generated in
-- the browser and never derived from anything about the person. Older or
-- third-party clients that send no installation identifier fall back to the
-- test wallet's own identity.
--
-- The row key is an HMAC of that identifier, never the identifier itself, so
-- the faucet can tell "this one already claimed" without holding a list of
-- installations or of the addresses it has funded.
--
-- Deliberately NOT keyed on anything derived from the caller's IP. Alice's
-- privacy contract is that an IP is hashed with a key that rotates daily and
-- is then forgotten, so an IP cannot carry a lifetime record by construction.

CREATE TABLE test_wallet_faucet_claims (
  claimer_hash TEXT PRIMARY KEY NOT NULL,
  claimed_at INTEGER NOT NULL
) STRICT;

CREATE INDEX test_wallet_faucet_claims_claimed_at_idx
  ON test_wallet_faucet_claims(claimed_at);
