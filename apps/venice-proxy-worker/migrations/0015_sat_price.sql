-- Prices are shown in satoshis, never in euros.
--
-- The plans are still worth 5 and 10 EUR, because that is what the models
-- underneath cost, so the satoshi figure has to be derived from a rate. A rate
-- recomputed on every page load would make the price flicker, which reads as a
-- moving target rather than a price. So one rate is pinned here, the whole
-- product quotes from it, and the hourly cron replaces it only when it has
-- aged out or drifted far enough to matter.
--
-- One row, keyed by currency, so a second anchor currency later is a row and
-- not a migration.
CREATE TABLE IF NOT EXISTS sat_price_pin (
  currency TEXT PRIMARY KEY,
  -- The BTC price in minor units of `currency`, as fetched. Kept rather than
  -- the derived satoshi figure so that a change of rounding step does not need
  -- a new fetch, and so drift can be measured against what was actually used.
  rate_minor INTEGER NOT NULL CHECK (rate_minor > 0),
  pinned_at INTEGER NOT NULL
) STRICT;

-- What the buyer was actually asked for, in the unit they were asked in.
-- `amount_cents` stays as the accounting figure; this is the quoted one, and
-- the two can disagree once the rate moves, which is exactly why both are kept.
ALTER TABLE invoices ADD COLUMN amount_sats INTEGER;
