-- Serializes test wallet faucet payouts.
--
-- The dispensing wallet spends its own change in a chain, so two concurrent
-- payouts would build two transactions spending the same coin and one would
-- be rejected by the network. A single-row lease makes payouts strictly
-- sequential; the lease expires on its own so a crashed request can never
-- wedge the faucet shut.

CREATE TABLE test_wallet_faucet_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked_until INTEGER NOT NULL
) STRICT;

INSERT INTO test_wallet_faucet_lock (id, locked_until) VALUES (1, 0);
