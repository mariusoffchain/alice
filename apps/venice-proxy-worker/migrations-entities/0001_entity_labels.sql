-- Server-side entity attribution for the explorer. The client bundles the small,
-- compliance-critical set (OFAC sanctioned + named exchange/mixer packs); the
-- giant enumerated packs (e.g. an exchange's tens of thousands of reserve
-- addresses) live here instead of bloating every client download.
--
-- Every row is public, sourced and dated, exactly like the bundled dataset: the
-- lookup returns "probably belongs to X", never an unsourced assertion.

CREATE TABLE IF NOT EXISTS entity_labels (
  address      TEXT NOT NULL,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  confidence   TEXT NOT NULL,
  source       TEXT NOT NULL,
  source_label TEXT NOT NULL,
  seen_date    TEXT NOT NULL,
  -- One address can carry several labels; a row is unique per (address, name,
  -- source) so re-running ingestion upserts rather than duplicating.
  PRIMARY KEY (address, name, source)
);

CREATE INDEX IF NOT EXISTS idx_entity_labels_address ON entity_labels (address);
