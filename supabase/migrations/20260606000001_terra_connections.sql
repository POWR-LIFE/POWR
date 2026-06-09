-- =============================================================
-- TERRA CONNECTIONS
-- Durable mapping between a Terra-issued user_id and a POWR user, one row
-- per connected provider. Terra issues a distinct user_id per provider
-- connection, so (terra_user_id) is the primary key. Populated/maintained
-- by the terra-webhook edge function (service role) on `auth`/`deauth`
-- events; it's the authoritative source for resolving incoming data
-- webhooks back to a POWR user and for the admin wearable overview.
-- =============================================================

create table public.terra_connections (
  terra_user_id text primary key,                 -- Terra's per-connection user id
  user_id       uuid not null references public.profiles(id) on delete cascade,
  provider      text not null,                    -- 'WHOOP' | 'OURA' | 'GARMIN' | 'STRAVA' | 'FITBIT' | 'HUAWEI'
  created_at    timestamptz not null default now(),
  deauthed_at   timestamptz                       -- set when the user revokes / Terra reports deauth
);

create index terra_connections_user_id_idx on public.terra_connections (user_id);

alter table public.terra_connections enable row level security;

-- Users may read their own connections (UI / debugging). All writes go through
-- the webhook with the service role key, which bypasses RLS — so no
-- insert/update/delete policies are defined for end users.
create policy "Users can read their own terra connections"
  on public.terra_connections for select
  using (auth.uid() = user_id);
