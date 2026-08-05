-- Check-in announce: the "You're in" banner as a SERVER push for Android.
--
-- The client's local notification silently fails when the check-in happens in a
-- headless Android context (scheduleNotificationAsync no-ops there; known since
-- 2026-07-14, user-visible 2026-08-05 when the first-ever headless Android
-- check-in produced no banner). The gym-visit-beacon now announces any android
-- visit the client hasn't marked as locally-announced within a grace window,
-- over the same visible-push path as "Session recorded" — which demonstrably
-- reaches swiped-away phones.
--
-- iOS is excluded from the server announce: its headless local banner works
-- (proven from a force-quit relaunch, 2026-08-05), and its frozen-network
-- visits have no server row to announce until app-open anyway.

alter table public.gym_visits
  add column if not exists announced_at timestamptz;

-- The beacon's announce scan: fresh, live, unannounced visits. Partial index
-- keeps the every-minute cron query off the table's history.
create index if not exists gym_visits_announce_due_idx
  on public.gym_visits (started_at)
  where announced_at is null and ended_at is null and platform = 'android';

-- Owner-locked: the client calls this after it successfully DISPLAYED the local
-- banner, so the beacon knows not to send the push copy. Idempotent; marking an
-- already-announced visit is a no-op.
create or replace function public.mark_gym_visit_announced(p_visit_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update gym_visits
     set announced_at = now()
   where id = p_visit_id
     and user_id = auth.uid()
     and announced_at is null;
$$;

revoke all on function public.mark_gym_visit_announced(uuid) from public;
grant execute on function public.mark_gym_visit_announced(uuid) to authenticated;
