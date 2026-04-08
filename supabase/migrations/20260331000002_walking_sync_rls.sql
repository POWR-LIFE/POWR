-- =============================================================
-- Walking auto-sync RLS: allow client to update sessions & streaks
-- =============================================================

-- The walking health-sync updates step counts on existing sessions
-- throughout the day. Without an UPDATE policy the .update() call
-- is silently rejected by RLS and the session keeps its initial
-- step count forever.
create policy "Users can update their own sessions"
  on public.activity_sessions for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Walking auto-sync also needs to mark today as an active streak
-- day. The claim-points Edge Function does this for gym sessions,
-- but walking bypasses that path and writes directly.
create policy "Users can update their own streak"
  on public.user_streaks for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
