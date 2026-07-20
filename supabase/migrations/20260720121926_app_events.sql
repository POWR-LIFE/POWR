-- ── app_events: product analytics for the admin panel ──────────────────────
--
-- Until now nothing recorded how members MOVE through the app. We know what
-- they train (activity_sessions), what they spend (point_transactions) and
-- where they check in (gym_visits) — but not which screens they open, which
-- buttons they press, or where they give up. reward_placement_events was built
-- with roughly this shape and never wired to a writer, which is why it still
-- reads 0 rows; this table is the general-purpose version, and it ships with
-- its client writer in the same change.
--
-- DESIGN NOTES
--
-- 1. Aggregation lives in RPCs below, never in the browser. VaultManager taught
--    us this the hard way: an unbounded PostgREST select silently caps at 1000
--    rows, so a panel that reduces raw rows client-side starts under-reporting
--    the moment the table outgrows the ceiling — no error, no warning. An
--    events table crosses 1000 rows in days, so client-side reduction was never
--    an option here.
--
-- 2. session_id is client-generated per app launch (not an auth session). It is
--    what makes ordering questions answerable — screen A → screen B flows,
--    which screen a visit dies on — none of which can be reconstructed from
--    timestamps alone once two members are active at once.
--
-- 3. Column widths are constrained on purpose. Every value written here is a
--    developer-authored constant (a route name, a button id), never user text.
--    The length caps are a backstop that keeps a future careless call site from
--    turning this table into a free-text dumping ground, and keep personal data
--    out of a table built to be read in aggregate by admins.

create table if not exists public.app_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Per-app-launch id from the client. Groups events into a single "visit".
  session_id   text not null check (length(session_id) <= 64),
  event_type   text not null check (event_type in ('screen_view', 'tap', 'custom')),
  -- Route the event happened on, e.g. '/wallet', '/(tabs)/progress'.
  route        text check (length(route) <= 128),
  -- For taps: the button identifier, e.g. 'redeem_reward'. Null for screen views.
  target       text check (length(target) <= 128),
  -- Small structured bag for context (never free text, never PII).
  props        jsonb,
  platform     text check (length(platform) <= 16),
  app_version  text check (length(app_version) <= 32),
  created_at   timestamptz not null default now()
);

-- Every admin query is "recent events, sliced by one dimension", so each index
-- leads with the slice column and carries created_at for the time window.
create index if not exists app_events_created_idx  on public.app_events (created_at desc);
create index if not exists app_events_route_idx    on public.app_events (route, created_at desc);
create index if not exists app_events_target_idx   on public.app_events (target, created_at desc) where target is not null;
create index if not exists app_events_session_idx  on public.app_events (session_id, created_at);
create index if not exists app_events_user_idx     on public.app_events (user_id, created_at desc);

alter table public.app_events enable row level security;

-- Members may only ever append their own events. There is deliberately no
-- select policy for members: this table is written by the app and read only in
-- aggregate by admins, so a member has no reason to read even their own rows.
drop policy if exists "app_events insert own" on public.app_events;
create policy "app_events insert own"
  on public.app_events for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "app_events admin read" on public.app_events;
create policy "app_events admin read"
  on public.app_events for select
  to authenticated
  using (exists (select 1 from admin_roles where user_id = auth.uid()));

comment on table public.app_events is
  'Product analytics: screen views and button taps from the mobile app. Written by lib/analytics.ts, read in aggregate by the admin Usage panel. Contains no free text and no PII by construction.';

-- ── Remote controls ────────────────────────────────────────────────────────
--
-- Two knobs in system_config so collection can be throttled or killed outright
-- without shipping a build or an OTA. The client caches both to AsyncStorage
-- and re-reads them at launch, so a kill takes effect on next app open even if
-- the device is then offline. If the app never reaches these rows it falls back
-- to enabled-at-100%, matching the values seeded here.
insert into public.system_config (key, value, description)
values
  ('analytics_enabled',     'true', 'Master switch for in-app product analytics (screen views + taps). Set false to stop collection at the next app launch.'),
  ('analytics_sample_pct',  '100',  'Percentage of app launches that report analytics events (0-100). Lower this if event volume ever becomes a cost or performance problem.')
on conflict (key) do nothing;

-- ── Admin read RPCs ────────────────────────────────────────────────────────

-- Headline counters for the top of the panel.
create or replace function public.admin_usage_overview(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_out   jsonb;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  select jsonb_build_object(
    'events',        count(*),
    'screen_views',  count(*) filter (where event_type = 'screen_view'),
    'taps',          count(*) filter (where event_type = 'tap'),
    'users',         count(distinct user_id),
    'app_sessions',  count(distinct session_id),
    'screens_per_session',
      round(
        count(*) filter (where event_type = 'screen_view')::numeric
        / greatest(count(distinct session_id), 1)
      , 1)
  )
  into v_out
  from app_events
  where created_at >= v_since;

  return v_out;
end;
$$;

-- Per-screen usage: how often it is opened, by how many people, how long they
-- stay, and how often a visit ENDS there.
--
-- Dwell is derived, not measured: the client does not report a leave event, so
-- time-on-screen is the gap to the next screen view in the same app session.
-- The last screen of a session has no successor, which is what makes it an exit
-- — so the same window that computes dwell also identifies drop-off. Gaps are
-- capped at 30 minutes so a member who puts their phone down mid-session does
-- not report a four-hour visit to the wallet.
create or replace function public.admin_usage_screens(p_days int default 30)
returns table (
  route         text,
  views         bigint,
  users         bigint,
  avg_dwell_sec numeric,
  exits         bigint,
  exit_pct      numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  with ordered as (
    select
      e.route,
      e.user_id,
      e.session_id,
      e.created_at,
      lead(e.created_at) over (partition by e.session_id order by e.created_at) as next_at
    from app_events e
    where e.created_at >= v_since
      and e.event_type = 'screen_view'
      and e.route is not null
  )
  select
    o.route,
    count(*)                                          as views,
    count(distinct o.user_id)                         as users,
    round(avg(
      least(extract(epoch from (o.next_at - o.created_at)), 1800)
    ) filter (where o.next_at is not null)::numeric, 1) as avg_dwell_sec,
    count(*) filter (where o.next_at is null)          as exits,
    round(
      100.0 * count(*) filter (where o.next_at is null) / greatest(count(*), 1)
    , 1)                                              as exit_pct
  from ordered o
  group by o.route
  order by views desc;
end;
$$;

-- Screen-to-screen transitions — the navigation graph. Self-transitions are
-- dropped: expo-router re-emits the same path on param-only changes, and those
-- would otherwise dominate the results with meaningless A→A edges.
create or replace function public.admin_usage_flows(p_days int default 30, p_limit int default 40)
returns table (
  from_route text,
  to_route   text,
  moves      bigint,
  users      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  with steps as (
    select
      e.route as from_route,
      lead(e.route)   over (partition by e.session_id order by e.created_at) as to_route,
      e.user_id
    from app_events e
    where e.created_at >= v_since
      and e.event_type = 'screen_view'
      and e.route is not null
  )
  select
    s.from_route,
    s.to_route,
    count(*)                  as moves,
    count(distinct s.user_id) as users
  from steps s
  where s.to_route is not null
    and s.to_route is distinct from s.from_route
  group by s.from_route, s.to_route
  order by moves desc
  limit greatest(p_limit, 1);
end;
$$;

-- Button presses, split by the screen they happened on: the same 'share' button
-- can live on three screens and only one of them may be working.
create or replace function public.admin_usage_taps(p_days int default 30, p_limit int default 60)
returns table (
  target text,
  route  text,
  taps   bigint,
  users  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  select
    e.target,
    e.route,
    count(*)                  as taps,
    count(distinct e.user_id) as users
  from app_events e
  where e.created_at >= v_since
    and e.event_type = 'tap'
    and e.target is not null
  group by e.target, e.route
  order by taps desc
  limit greatest(p_limit, 1);
end;
$$;

-- Activity by hour of day, for the usage grid. Separate from the training-hours
-- chart on the existing Analytics page: that one asks when members WORK OUT,
-- this one asks when they OPEN THE APP, and the two answers are not the same.
create or replace function public.admin_usage_by_hour(p_days int default 30)
returns table (
  dow    int,
  hour   int,
  events bigint,
  users  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  select
    extract(dow  from e.created_at)::int as dow,
    extract(hour from e.created_at)::int as hour,
    count(*)                             as events,
    count(distinct e.user_id)            as users
  from app_events e
  where e.created_at >= v_since
  group by 1, 2
  order by 1, 2;
end;
$$;

revoke all on function public.admin_usage_overview(int) from public, anon;
revoke all on function public.admin_usage_screens(int)  from public, anon;
revoke all on function public.admin_usage_flows(int, int) from public, anon;
revoke all on function public.admin_usage_taps(int, int)  from public, anon;
revoke all on function public.admin_usage_by_hour(int)  from public, anon;

grant execute on function public.admin_usage_overview(int) to authenticated;
grant execute on function public.admin_usage_screens(int)  to authenticated;
grant execute on function public.admin_usage_flows(int, int) to authenticated;
grant execute on function public.admin_usage_taps(int, int)  to authenticated;
grant execute on function public.admin_usage_by_hour(int)  to authenticated;
