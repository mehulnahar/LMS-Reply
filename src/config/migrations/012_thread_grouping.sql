-- 012_thread_grouping.sql
-- Composite index to optimize thread-grouped inbox queries
-- Covers: GROUP BY thread_id, ORDER BY received_at DESC, filtered by user_id

CREATE INDEX IF NOT EXISTS idx_emails_thread_group
ON emails (user_id, thread_id, received_at DESC);
