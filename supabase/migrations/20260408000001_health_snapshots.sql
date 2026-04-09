-- =============================================================
-- HEALTH SNAPSHOTS
-- Raw health data synced from HealthKit / Health Connect.
-- One row per sync event, linked to the activity session when
-- applicable.  Gives admins and analytics a full picture of
-- user health telemetry alongside points earned.
-- =============================================================

-- Add sleep and dance to the activity_type enum
alter type public.activity_type add value if not exists 'sleep';
alter type public.activity_type add value if not exists 'dance';

create table public.health_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  session_id      uuid references public.activity_sessions(id) on delete set null,
  recorded_at     timestamptz not null default now(),

  -- Steps & distance
  steps           int,
  distance_m      float,

  -- Heart rate
  hr_avg          int,
  hr_max          int,
  hr_resting      int,

  -- Calories
  calories_active float,
  calories_total  float,

  -- Sleep breakdown (hours)
  sleep_duration_h  float,
  sleep_deep_h      float,
  sleep_rem_h       float,
  sleep_light_h     float,

  -- Workout metadata
  activity_type   text,           -- raw type string from device
  duration_sec    int,

  -- Source
  source          text not null default 'healthkit',  -- 'healthkit' | 'health_connect'

  created_at      timestamptz not null default now()
);

create index on public.health_snapshots (user_id, recorded_at desc);
create index on public.health_snapshots (session_id);

-- RLS
alter table public.health_snapshots enable row level security;

create policy "Users can read their own health snapshots"
  on public.health_snapshots for select
  using (auth.uid() = user_id);

create policy "Users can insert their own health snapshots"
  on public.health_snapshots for insert
  with check (auth.uid() = user_id);

-- Set user_id default from auth context so client inserts don't need
-- to pass user_id explicitly — matches activity_sessions pattern.
alter table public.health_snapshots
  alter column user_id set default auth.uid();

-- Admin read via service role (bypasses RLS)
