-- Deep Research becomes a monthly allowance instead of a growing pile.
--
-- It was stored as a stock of credits added at purchase, multiplied by the
-- number of months bought. Someone prepaying six months would have received
-- 126 runs on day one and could have spent them all in an afternoon, which is
-- not what "21 Deep Research runs each month" says. It is metered like the
-- byte allowance now: a limit on the entitlement, a counter that resets when
-- the period rolls.
--
-- Nothing was decremented before this, so no real balance is being lost. The
-- limit is set from the plan rather than carried over, because a carried-over
-- pile is exactly the thing being removed.
ALTER TABLE entitlements RENAME COLUMN deep_research_credits TO deep_research_limit;

ALTER TABLE usage_counters ADD COLUMN deep_research_used INTEGER NOT NULL DEFAULT 0;

-- 21 is the shipped default for Cloud+ (PLAN_CLOUD_PLUS_DEEP_RESEARCH). A
-- migration cannot read the environment, so it writes the default and the next
-- renewal writes whatever the variable says.
UPDATE entitlements
SET deep_research_limit = CASE WHEN plan = 'cloud_plus' THEN 21 ELSE 0 END;
