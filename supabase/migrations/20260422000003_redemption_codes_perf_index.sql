-- =============================================================
-- PERFORMANCE: Better index for claim_pool_code RPC
--
-- The existing idx_codes_pool (reward_id, status) doesn't cover
-- the ORDER BY created_at, forcing a sort on every claim.
-- At scale (50k+ codes per reward, thousands of concurrent claims)
-- this becomes a bottleneck.
--
-- Fix 1: Partial index — only indexes available codes.
--   As codes are claimed (status → reserved/used) they drop out of
--   this index automatically, keeping it tiny and fast regardless
--   of total table size.
--
-- Fix 2: Include created_at so the ORDER BY is resolved from the
--   index without touching the heap.
-- =============================================================

-- Drop the old broad index (optional — keeping it won't hurt, but
-- it's redundant once the partial index exists).
drop index if exists public.idx_codes_pool;

-- New partial index: only available codes, ordered by created_at.
-- Postgres will use this for the exact query in claim_pool_code.
create index if not exists idx_codes_available
  on public.redemption_codes (reward_id, created_at)
  where status = 'available';

-- Supplementary index for ledger/admin queries (all statuses, fast on reward).
create index if not exists idx_codes_by_reward
  on public.redemption_codes (reward_id, status, created_at desc);
