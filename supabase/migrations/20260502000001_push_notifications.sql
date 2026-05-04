-- Push notification tokens per device
create table if not exists public.user_push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  device_token  text,
  platform      text not null check (platform in ('ios', 'android')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_user_expo_token unique (user_id, expo_push_token)
);

alter table public.user_push_tokens enable row level security;

-- Users can only read/write their own tokens
create policy "users manage own push tokens"
  on public.user_push_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service role (Edge Functions) can read all tokens to send notifications
create policy "service role read all push tokens"
  on public.user_push_tokens
  for select
  using (auth.role() = 'service_role');

-- Notification preferences per user
create table if not exists public.notification_preferences (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  daily_reminder          boolean not null default true,
  daily_reminder_hour     smallint not null default 8,
  daily_reminder_minute   smallint not null default 0,
  streak_at_risk          boolean not null default true,
  weekly_challenge_expiry boolean not null default true,
  reward_unlocked         boolean not null default true,
  check_in_reminder       boolean not null default true,
  points_milestone        boolean not null default true,
  inactivity_nudge        boolean not null default true,
  updated_at              timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "users manage own notification preferences"
  on public.notification_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-create default preferences row when a new user signs up
create or replace function public.handle_new_user_notification_prefs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notification_prefs on auth.users;
create trigger on_auth_user_created_notification_prefs
  after insert on auth.users
  for each row execute procedure public.handle_new_user_notification_prefs();

-- Index for fast token lookups by user
create index if not exists idx_user_push_tokens_user_id
  on public.user_push_tokens (user_id);
