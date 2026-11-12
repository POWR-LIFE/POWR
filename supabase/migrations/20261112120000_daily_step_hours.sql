-- =============================================================
-- DAILY STEP HOURS
-- Steps per local hour, one row per member per local date, read from the
-- phone's health store (HealthKit / Health Connect). Wearables mirror their
-- steps into that store, so this covers Garmin / Whoop wearers too.
--
-- Why: activity_sessions keeps walking as ONE row per day (midnight to
-- midnight), so the time of day a member walks was never stored. Workouts and
-- sleep already carry real start/end times; this fills the gap so the admin
-- user profile can show when a member is active across the whole day.
--
-- Kept apart from daily_step_windows on purpose: that table drives the
-- time-of-day walking challenges, and back-filling hours for past days must not
-- change what those challenges see.
--
-- steps[1] = 00:00–01:00 local … steps[24] = 23:00–24:00 local (Postgres arrays
-- are 1-based). Today's row is partial until the day ends; updated_at says how
-- far it got (a row written after the next local midnight is final).
-- =============================================================

create table if not exists public.daily_step_hours (
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  date        date not null,           -- member's LOCAL date
  steps       int[] not null,          -- 24 entries, local hours 0..23
  updated_at  timestamptz not null default now(),

  constraint daily_step_hours_pkey primary key (user_id, date),
  constraint daily_step_hours_24 check (cardinality(steps) = 24),
  constraint daily_step_hours_non_negative check (0 <= all(steps))
);

alter table public.daily_step_hours enable row level security;

create policy "Users can read their own step hours"
  on public.daily_step_hours for select
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own step hours"
  on public.daily_step_hours for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own step hours"
  on public.daily_step_hours for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- The admin user profile reads a member's rows directly, the same way it reads
-- health_snapshots. Every app read of this table filters on user_id explicitly,
-- so an admin signed into the app still only sees their own rows.
create policy "Admins can read all step hours"
  on public.daily_step_hours for select
  using (exists (select 1 from public.admin_roles where admin_roles.user_id = (select auth.uid())));
