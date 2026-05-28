-- =============================================================
-- DAILY STEP WINDOWS
-- Intraday step buckets synced from HealthKit / Health Connect so
-- time-of-day step challenges (Lunch Walk / Evening Stroll / Morning
-- Walker) can be evaluated. One row per user per local date; the
-- client upserts the running totals for each window throughout the day.
-- =============================================================

create table public.daily_step_windows (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  date          date not null,            -- user's LOCAL date (YYYY-MM-DD)
  before_9am    int not null default 0,   -- steps before 09:00 local
  midday_12_14  int not null default 0,   -- steps 12:00–14:00 local
  after_6pm     int not null default 0,   -- steps after 18:00 local
  updated_at    timestamptz not null default now(),

  constraint daily_step_windows_pkey primary key (user_id, date)
);

-- Default user_id from auth context — matches health_snapshots pattern.
alter table public.daily_step_windows
  alter column user_id set default auth.uid();

alter table public.daily_step_windows enable row level security;

create policy "Users can read their own step windows"
  on public.daily_step_windows for select
  using (auth.uid() = user_id);

create policy "Users can insert their own step windows"
  on public.daily_step_windows for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own step windows"
  on public.daily_step_windows for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
