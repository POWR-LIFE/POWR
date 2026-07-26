-- Progress page read-path indexes.
--
-- Every Progress fetcher embeds point_transactions(amount), which PostgREST
-- compiles to a LEFT JOIN LATERAL carrying LIMIT/OFFSET. Postgres cannot
-- de-correlate that into a hash join, so each parent row drives its own scan of
-- point_transactions. With no plain session_id index those were full sequential
-- scans: buffers-per-loop equals relpages(point_transactions), which means one
-- user's Progress page gets slower as OTHER users earn points.
--
-- Measured on prod before this migration (user with 223 sessions):
--   fetchRecentSessions(5)  7,115 buffers / 223 lateral loops to return 5 rows
--   30-day walking heatmap    967 buffers /  29 lateral loops
-- After:                       19 buffers /   5 loops, and 140 / 29.
--
-- Two separate causes, hence two indexes:
--
-- 1. point_transactions(session_id) turns each lateral loop from a 31-page seq
--    scan into an index lookup. Note the existing unique index on
--    (session_id, description) WHERE type='earn' AND description IS NOT NULL is
--    partial, so the planner cannot use it for a bare session_id equality.
--
-- 2. activity_sessions(user_id, ended_at DESC NULLS LAST) matches
--    fetchRecentSessions' ORDER BY exactly. Without it the plan puts a Sort
--    above the Nested Loop, which defeats early termination of LIMIT 5 and runs
--    the lateral for all 223 of the user's sessions instead of 5. DESC alone
--    would imply NULLS FIRST and not match the query, so the NULLS LAST is
--    load-bearing (in-progress sessions have a null ended_at).
--
-- Both tables are small (43 and 31 pages), so a plain CREATE INDEX takes
-- milliseconds; CONCURRENTLY is unnecessary and cannot run inside a migration's
-- transaction anyway.
--
-- Verify changes here with BUFFER COUNTS, not milliseconds: timings on this
-- instance vary >2x between identical runs of the same plan.

create index if not exists point_transactions_session_id_idx
    on public.point_transactions (session_id);

create index if not exists activity_sessions_user_id_ended_at_idx
    on public.activity_sessions (user_id, ended_at desc nulls last);

analyze public.point_transactions;
analyze public.activity_sessions;
