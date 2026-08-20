-- ── Usage panel: an explicit window, not just a trailing one ───────────────
--
-- Every admin_usage_* RPC took p_days and derived `now() - p_days`, which makes
-- exactly one shape of question answerable: "the last N days ending right now".
-- That is why the panel reads as an ever-growing accumulation — there is no way
-- to ask about a PARTICULAR week, so a spike can be seen but never returned to,
-- and two weeks can never be compared.
--
-- Each function now also accepts p_start / p_end (timestamptz). Semantics:
--
--   v_end   := coalesce(p_end, now())
--   v_since := coalesce(p_start, v_end - p_days)
--   window  := [v_since, v_end)
--
-- so an existing p_days-only call keeps its old meaning and a caller that wants
-- a bounded period passes both ends. Half-open on purpose: consecutive weeks
-- passed as [Mon 00:00, next Mon 00:00) tile the timeline exactly once, whereas
-- an inclusive upper bound double-counts the boundary instant into both.
--
-- The argument lists change, so each function is dropped first — CREATE OR
-- REPLACE cannot add parameters. Dropping also matters for PostgREST: leaving
-- the old signature in place would make { p_days } an ambiguous overload and
-- every existing call would start failing rather than resolving.
--
-- admin_usage_by_hour additionally takes p_tz. Its grid is labelled with days of
-- the week and hours of the day, and it was bucketing in UTC — tolerable while
-- the window was a vague trailing month, wrong once the window IS a named week,
-- because a Sunday 00:30 London event would land in the Saturday row of a grid
-- whose title says the week starts on Monday.

drop function if exists public.admin_usage_overview(int);
drop function if exists public.admin_usage_screens(int);
drop function if exists public.admin_usage_flows(int, int);
drop function if exists public.admin_usage_taps(int, int);
drop function if exists public.admin_usage_by_hour(int);
drop function if exists public.admin_usage_paths(int, int, int);
drop function if exists public.admin_usage_entries(int);
drop function if exists public.admin_usage_heatmap(text, int, int);

-- ── Headline counters ──────────────────────────────────────────────────────
create or replace function public.admin_usage_overview(
  p_days  int default 30,
  p_start timestamptz default null,
  p_end   timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_end   timestamptz := coalesce(p_end, now());
  v_since timestamptz := coalesce(p_start, v_end - make_interval(days => greatest(p_days, 1)));
  v_out   jsonb;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  select jsonb_build_object(
    'events',        count(*),
    'screen_views',  count(*) filter (where event_type = 'screen_view'),
    'taps',          count(*) filter (where event_type = 'tap'),
    'touches',       count(*) filter (where event_type = 'touch'),
    'users',         count(distinct user_id),
    'app_sessions',  count(distinct session_id),
    'screens_per_session',
      round(
        count(*) filter (where event_type = 'screen_view')::numeric
        / greatest(count(distinct session_id) filter (where event_type = 'screen_view'), 1)
      , 1)
  )
  into v_out
  from app_events
  where created_at >= v_since
    and created_at <  v_end;

  return v_out;
end;
$$;

-- ── Per-screen usage ───────────────────────────────────────────────────────
--
-- Dwell is still the gap to the next screen view in the same app session,
-- capped at 30 minutes, and a screen with no successor is still an exit. Note
-- that the window clips the session as well as the events: a visit straddling
-- the boundary reports its last in-window screen as an exit. That is the honest
-- reading for a bounded period — the alternative is dragging in events from
-- outside the week the admin asked about.
create or replace function public.admin_usage_screens(
  p_days  int default 30,
  p_start timestamptz default null,
  p_end   timestamptz default null
)
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
  v_end   timestamptz := coalesce(p_end, now());
  v_since timestamptz := coalesce(p_start, v_end - make_interval(days => greatest(p_days, 1)));
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
      and e.created_at <  v_end
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

-- ── Screen-to-screen transitions ───────────────────────────────────────────
create or replace function public.admin_usage_flows(
  p_days  int default 30,
  p_limit int default 40,
  p_start timestamptz default null,
  p_end   timestamptz default null
)
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
  v_end   timestamptz := coalesce(p_end, now());
  v_since timestamptz := coalesce(p_start, v_end - make_interval(days => greatest(p_days, 1)));
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  with steps as (
    select
      regexp_replace(e.route, '/\([^)]*\)', '', 'g') as from_route,
      lead(regexp_replace(e.route, '/\([^)]*\)', '', 'g'))
        over (partition by e.session_id order by e.created_at) as to_route,
      e.user_id
    from app_events e
    where e.created_at >= v_since
      and e.created_at <  v_end
      and e.event_type = 'screen_view'
      and e.route is not null
  )
  select s.from_route, s.to_route, count(*) as moves, count(distinct s.user_id) as users
  from steps s
  where s.to_route is not null
    and s.to_route is distinct from s.from_route
  group by s.from_route, s.to_route
  order by moves desc
  limit greatest(p_limit, 1);
end;
$$;

-- ── Button presses ─────────────────────────────────────────────────────────
create or replace function public.admin_usage_taps(
  p_days  int default 30,
  p_limit int default 60,
  p_start timestamptz default null,
  p_end   timestamptz default null
)
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
  v_end   timestamptz := coalesce(p_end, now());
  v_since timestamptz := coalesce(p_start, v_end - make_interval(days => greatest(p_days, 1)));
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
    and e.created_at <  v_end
    and e.event_type = 'tap'
    and e.target is not null
  group by e.target, e.route
  order by taps desc
  limit greatest(p_limit, 1);
end;
$$;

-- ── Activity by day & hour ─────────────────────────────────────────────────
--
-- p_tz names the timezone the day and hour are read in. An unknown or empty
-- name falls back to UTC rather than raising: `at time zone 'Garbage/Zone'`
-- throws, and one bad browser value must not blank the panel.
create or replace function public.admin_usage_by_hour(
  p_days  int default 30,
  p_start timestamptz default null,
  p_end   timestamptz default null,
  p_tz    text default 'UTC'
)
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
  v_end   timestamptz := coalesce(p_end, now());
  v_since timestamptz := coalesce(p_start, v_end - make_interval(days => greatest(p_days, 1)));
  v_tz    text := coalesce(nullif(btrim(p_tz), ''), 'UTC');
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  if not exists (select 1 from pg_timezone_names t where t.name = v_tz) then
    v_tz := 'UTC';
  end if;

  return query
  select
    extract(dow  from (e.created_at at time zone v_tz))::int as dow,
    extract(hour from (e.created_at at time zone v_tz))::int as hour,
    count(*)                             as events,
    count(distinct e.user_id)            as users
  from app_events e
  where e.created_at >= v_since
    and e.created_at <  v_end
  group by 1, 2
  order by 1, 2;
end;
$$;

-- ── Journeys ───────────────────────────────────────────────────────────────
create or replace function public.admin_usage_paths(
  p_days  int default 30,
  p_steps int default 4,
  p_limit int default 25,
  p_start timestamptz default null,
  p_end   timestamptz default null
)
returns table (
  path     text,
  journeys bigint,
  users    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_end   timestamptz := coalesce(p_end, now());
  v_since timestamptz := coalesce(p_start, v_end - make_interval(days => greatest(p_days, 1)));
  v_steps int := least(greatest(p_steps, 2), 8);
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  with ordered as (
    select
      e.session_id,
      e.user_id,
      regexp_replace(e.route, '/\([^)]*\)', '', 'g') as route,
      row_number() over (partition by e.session_id order by e.created_at) as rn,
      lag(regexp_replace(e.route, '/\([^)]*\)', '', 'g'))
        over (partition by e.session_id order by e.created_at) as prev_route
    from app_events e
    where e.created_at >= v_since
      and e.created_at <  v_end
      and e.event_type = 'screen_view'
      and e.route is not null
  ),
  deduped as (
    select session_id, user_id, route,
           row_number() over (partition by session_id order by rn) as step
    from ordered
    where prev_route is null or prev_route is distinct from route
  ),
  joined as (
    select session_id, user_id, string_agg(route, '  →  ' order by step) as path
    from deduped
    where step <= v_steps
    group by session_id, user_id
  )
  select j.path, count(*) as journeys, count(distinct j.user_id) as users
  from joined j
  where j.path like '%→%'   -- a single screen is not a journey
  group by j.path
  order by journeys desc
  limit greatest(p_limit, 1);
end;
$$;

-- ── Entry screens ──────────────────────────────────────────────────────────
create or replace function public.admin_usage_entries(
  p_days  int default 30,
  p_start timestamptz default null,
  p_end   timestamptz default null
)
returns table (
  route   text,
  entries bigint,
  users   bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_end   timestamptz := coalesce(p_end, now());
  v_since timestamptz := coalesce(p_start, v_end - make_interval(days => greatest(p_days, 1)));
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  with firsts as (
    select distinct on (e.session_id)
      e.session_id, e.user_id,
      regexp_replace(e.route, '/\([^)]*\)', '', 'g') as route
    from app_events e
    where e.created_at >= v_since
      and e.created_at <  v_end
      and e.event_type = 'screen_view'
      and e.route is not null
    order by e.session_id, e.created_at
  )
  select f.route, count(*) as entries, count(distinct f.user_id) as users
  from firsts f
  group by f.route
  order by entries desc;
end;
$$;

-- ── Heat points for one screen ─────────────────────────────────────────────
--
-- Still ordered newest-first under a limit, which matters more now than it did:
-- with a bounded window the limit clips the OLDEST touches of the chosen week
-- rather than the oldest of an open-ended trail, so a busy week returns its most
-- recent 4000 touches and the panel says so.
create or replace function public.admin_usage_heatmap(
  p_route text,
  p_days  int default 30,
  p_limit int default 4000,
  p_start timestamptz default null,
  p_end   timestamptz default null
)
returns table (
  x      real,
  y      real,
  target text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_end   timestamptz := coalesce(p_end, now());
  v_since timestamptz := coalesce(p_start, v_end - make_interval(days => greatest(p_days, 1)));
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  select e.x, e.y, e.target
  from app_events e
  where e.created_at >= v_since
    and e.created_at <  v_end
    and e.x is not null
    and e.route is not null
    and regexp_replace(e.route, '/\([^)]*\)', '', 'g') = regexp_replace(p_route, '/\([^)]*\)', '', 'g')
  order by e.created_at desc
  limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.admin_usage_overview(int, timestamptz, timestamptz)          from public, anon;
revoke all on function public.admin_usage_screens(int, timestamptz, timestamptz)           from public, anon;
revoke all on function public.admin_usage_flows(int, int, timestamptz, timestamptz)        from public, anon;
revoke all on function public.admin_usage_taps(int, int, timestamptz, timestamptz)         from public, anon;
revoke all on function public.admin_usage_by_hour(int, timestamptz, timestamptz, text)     from public, anon;
revoke all on function public.admin_usage_paths(int, int, int, timestamptz, timestamptz)   from public, anon;
revoke all on function public.admin_usage_entries(int, timestamptz, timestamptz)           from public, anon;
revoke all on function public.admin_usage_heatmap(text, int, int, timestamptz, timestamptz) from public, anon;

grant execute on function public.admin_usage_overview(int, timestamptz, timestamptz)          to authenticated;
grant execute on function public.admin_usage_screens(int, timestamptz, timestamptz)           to authenticated;
grant execute on function public.admin_usage_flows(int, int, timestamptz, timestamptz)        to authenticated;
grant execute on function public.admin_usage_taps(int, int, timestamptz, timestamptz)         to authenticated;
grant execute on function public.admin_usage_by_hour(int, timestamptz, timestamptz, text)     to authenticated;
grant execute on function public.admin_usage_paths(int, int, int, timestamptz, timestamptz)   to authenticated;
grant execute on function public.admin_usage_entries(int, timestamptz, timestamptz)           to authenticated;
grant execute on function public.admin_usage_heatmap(text, int, int, timestamptz, timestamptz) to authenticated;
