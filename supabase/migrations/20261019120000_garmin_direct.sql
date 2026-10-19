-- Garmin, direct (2026-10-19).
--
-- POWR now has its own Garmin Connect Developer Program app, so Garmin no
-- longer goes through Terra (whose shared Garmin access closed on 2026-09-22).
-- The user signs in to Garmin through the garmin-auth function; Garmin then
-- pushes their activities, daily summaries, sleep and HRV to garmin-webhook,
-- which credits them through the same engine as Terra (_shared/wearableIngest).
--
--   garmin_connections   who is linked to which Garmin account, and how fresh
--                        their data is. The user can read their own row.
--   garmin_tokens        the OAuth tokens. Server only: RLS on, no policies.
--   garmin_oauth_states  one row per sign-in in flight (PKCE verifier + state).
--                        Server only.
--
-- Rollout switch, system_config 'garmin_direct':
--   'off'     nobody can connect (the default — shipping this changes nothing)
--   'testers' admins, plus the user ids in 'garmin_direct_testers'
--   'on'      everyone
-- Our Garmin key is evaluation level until Garmin's production review passes,
-- and Garmin says evaluation keys are for testing only, so 'testers' is as far
-- as this goes before that review.

create table public.garmin_connections (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  -- Garmin's API user id. Stable across reconnects, and every push carries it.
  garmin_user_id  text not null,
  -- What the user ticked on Garmin's consent screen (ACTIVITY_EXPORT, HEALTH_EXPORT, ...).
  permissions     text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Set when the user disconnects (here or in Garmin Connect). The row is kept
  -- for history; a reconnect clears it.
  deregistered_at timestamptz,
  -- Freshness, same meaning as on terra_connections: when Garmin last
  -- delivered anything, and the watch that recorded the latest activity.
  last_upload_at  timestamptz,
  device_name     text
);

-- One live POWR account per Garmin account: the same watch paying two
-- accounts is the double credit project_duplicate_account_terra_double_credit
-- describes. A deregistered row doesn't block a new link.
create unique index garmin_connections_live_garmin_user
  on public.garmin_connections (garmin_user_id)
  where deregistered_at is null;

alter table public.garmin_connections enable row level security;

create policy "Users can read their own garmin connection"
  on public.garmin_connections for select
  to authenticated
  using (auth.uid() = user_id);

create table public.garmin_tokens (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  access_token       text not null,
  refresh_token      text not null,
  access_expires_at  timestamptz not null,
  refresh_expires_at timestamptz,
  updated_at         timestamptz not null default now()
);

alter table public.garmin_tokens enable row level security;
-- No policies: only the service role (garmin-auth, garmin-webhook) touches tokens.

create table public.garmin_oauth_states (
  state         text primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  code_verifier text not null,
  -- Where to send the user afterwards (powr://garmin-callback, or Expo Go's
  -- address in development). Checked against an allow-list before use.
  return_to     text not null,
  created_at    timestamptz not null default now()
);

create index garmin_oauth_states_created_at on public.garmin_oauth_states (created_at);

alter table public.garmin_oauth_states enable row level security;
-- No policies: server only.

insert into public.system_config (key, value, description)
values
  ('garmin_direct', 'off',
   'Garmin direct connection: off, testers (admins + garmin_direct_testers), or on. Keep at testers until Garmin approves our production key.'),
  ('garmin_direct_testers', '',
   'Comma-separated POWR user ids who can connect Garmin directly while garmin_direct is testers.')
on conflict (key) do nothing;

-- Whether p_user may connect Garmin directly. garmin-auth calls this with the
-- caller's id before starting a sign-in.
create or replace function public.garmin_direct_allowed(p_user uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  with mode as (
    select coalesce((select lower(btrim(value)) from public.system_config where key = 'garmin_direct'), 'off') as m
  )
  select case (select m from mode)
    when 'on' then true
    when 'testers' then
      exists (select 1 from public.admin_roles where user_id = p_user)
      or p_user::text = any (
        select btrim(x) from unnest(string_to_array(
          coalesce((select value from public.system_config where key = 'garmin_direct_testers'), ''), ',')) as x
      )
    else false
  end
$$;
revoke all on function public.garmin_direct_allowed(uuid) from public, anon, authenticated;
grant execute on function public.garmin_direct_allowed(uuid) to service_role;

-- The app asks this to decide whether the Garmin tile connects directly or
-- shows the "sync through your phone" sheet.
create or replace function public.garmin_direct_available()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and public.garmin_direct_allowed(auth.uid())
$$;
revoke all on function public.garmin_direct_available() from public, anon;
grant execute on function public.garmin_direct_available() to authenticated;
