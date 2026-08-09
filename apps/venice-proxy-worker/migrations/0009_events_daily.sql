PRAGMA foreign_keys = ON;

-- Aggregate product analytics. Counters only.
--
-- There is no user_id, no session id, no install id, no timestamp finer
-- than a day, and no ordering between events. A row says "on day D, event
-- E happened N times on platform P at version V" and nothing more, so no
-- individual behavioural profile can be reconstructed from this table even
-- in principle.
--
-- `event_name` is validated against a server-side allowlist before any row
-- is written. That allowlist is the control that stops arbitrary
-- client-supplied strings, which could otherwise carry user content, from
-- ever reaching storage.
CREATE TABLE events_daily (
  day INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, event_name, platform, app_version)
) STRICT;

CREATE INDEX events_daily_day_idx ON events_daily(day);
CREATE INDEX events_daily_event_name_idx ON events_daily(event_name);
