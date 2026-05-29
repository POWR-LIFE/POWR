-- =============================================================
-- CLAIM IDEMPOTENCY — prevent duplicate point claims per session
--
-- claim-points / upgrade-gym-tier guard against double-claiming with a
-- non-atomic "count existing rows, then insert" check. Two concurrent
-- invocations (e.g. the foreground dwell timer racing the background exit
-- handler, which run in separate JS contexts and cannot share an in-process
-- lock) can both pass the check and both insert, awarding points twice.
--
-- This partial unique index is the authoritative backstop: at most one earn
-- row per (session_id, description). It still allows the legitimate two-row
-- pattern for a gym session:
--     'gym session'                  (20-min base, +10)
--     'gym session upgrade (45min)'  (45-min tier top-up, +5)
-- because those carry different descriptions.
--
-- Scoped to `description IS NOT NULL` so it does not constrain the separate
-- wearable-sync ingestion path, whose rows have a null description.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS point_transactions_unique_earn_per_session_desc
    ON public.point_transactions (session_id, description)
    WHERE type = 'earn' AND description IS NOT NULL;
