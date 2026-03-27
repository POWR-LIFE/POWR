-- =============================================================
-- ACTIVITY SESSIONS + USER STREAKS
-- =============================================================

create type public.activity_type as enum (
  'walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga'
);

create type public.verification_method as enum (
  'geofence', 'gps', 'hr', 'wearable', 'manual'
);

create table public.activity_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  type          public.activity_type not null,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  duration_sec  int not null,
  distance_m    float,
  steps         int,
  hr_avg        int,
  hr_zone_pct   float,
  verification  public.verification_method not null default 'manual',
  trust_score   float not null default 0.5,
  flagged       bool not null default false,
  raw_gps       jsonb,   -- encrypted GPS path stored as pgp_sym_encrypt output
  created_at    timestamptz not null default now()
);

create index on public.activity_sessions (user_id, started_at desc);

-- RLS
alter table public.activity_sessions enable row level security;

create policy "Users can read their own sessions"
  on public.activity_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own sessions"
  on public.activity_sessions for insert
  with check (auth.uid() = user_id);

-- No client-side update or delete

-- =============================================================
-- USER STREAKS
-- =============================================================

create table public.user_streaks (
  user_id             uuid primary key references public.profiles(id) on delete cascade,
  current_streak      int not null default 0,
  longest_streak      int not null default 0,
  last_activity_date  date,
  freeze_tokens       int not null default 1
);

-- Auto-create streak row alongside profile
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_streaks (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_profile_created
  after insert on public.profiles
  for each row execute procedure public.handle_new_profile();

-- RLS
alter table public.user_streaks enable row level security;

create policy "Users can read their own streak"
  on public.user_streaks for select
  using (auth.uid() = user_id);

-- Updates only via service role (Edge Functions)
