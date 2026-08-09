PRAGMA foreign_keys = ON;

-- Milestones, not an event stream.
--
-- Each column records "this installation reached step X at time T", written
-- once and never overwritten. That is enough for funnels, retention and
-- cohort analysis, while keeping what Alice stores fully enumerable: there
-- is no per-action log and no way to reconstruct a behavioural timeline.
--
-- Deliberately absent: anything about the wallet. The server has no reason
-- to know a wallet exists, when it was created, or that it was used. Cloud
-- request milestones are recorded only because those requests already pass
-- through this proxy on their way to Venice.

-- Latest observed platform and app version for this installation. Both are
-- validated server-side against an allowlist/regex before being written, so
-- they can never carry arbitrary client-supplied text.
ALTER TABLE installations ADD COLUMN platform TEXT;
ALTER TABLE installations ADD COLUMN app_version TEXT;

ALTER TABLE installations ADD COLUMN first_cloud_request_at INTEGER;
ALTER TABLE installations ADD COLUMN tenth_cloud_request_at INTEGER;
ALTER TABLE installations ADD COLUMN quota_exhausted_at INTEGER;
ALTER TABLE installations ADD COLUMN account_created_at INTEGER;

CREATE INDEX installations_first_seen_at_idx ON installations(first_seen_at);
CREATE INDEX installations_platform_idx ON installations(platform);
