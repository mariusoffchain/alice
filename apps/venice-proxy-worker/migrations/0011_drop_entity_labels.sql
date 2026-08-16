-- Move the explorer's entity labels out of the accounts database.
--
-- 0010 created this table here, which was a mistake: the labels are public
-- data with their own refresh cycle, and re-ingesting them takes the database
-- offline for the duration. Sharing a database meant a routine label refresh
-- would also take account sign-in down. The public, unauthenticated lookup
-- endpoint also had no business holding a handle to the accounts database.
--
-- The table now lives in alice-entities (migrations-entities/0001), so drop it
-- here. Dropping the index first is not required, SQLite removes it with the
-- table, but it keeps the intent explicit.

DROP INDEX IF EXISTS idx_entity_labels_address;
DROP TABLE IF EXISTS entity_labels;
