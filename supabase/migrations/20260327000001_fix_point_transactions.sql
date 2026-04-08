-- =============================================================
-- Fix point_transactions: add source column, user_id default,
-- and insert RLS policy so client-side writes work correctly.
-- Also set user_id defaults on activity_sessions.
-- =============================================================

-- 1. Add source column (used by app to distinguish health_sync vs manual_log)
alter table public.point_transactions
  add column if not exists source text;

-- 2. Set user_id defaults from auth context so client inserts don't need
--    to pass user_id explicitly — auth.uid() is resolved at insert time.
alter table public.activity_sessions
  alter column user_id set default auth.uid();

alter table public.point_transactions
  alter column user_id set default auth.uid();

-- 3. Allow users to insert their own point transactions (app writes directly,
--    no Edge Function intermediary).
create policy "Users can insert their own transactions"
  on public.point_transactions for insert
  with check (auth.uid() = user_id);
