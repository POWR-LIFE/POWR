-- Journey analysis: the ordered sequences members actually walk, plus where
-- visits start.
--
-- admin_usage_flows already answers "A → B" one hop at a time, which is enough
-- to draw a graph but not enough to answer "what does a visit look like".
-- A two-hop edge list cannot distinguish Home→Rewards→Wallet from
-- Home→Rewards and a separate Progress→Wallet; only the ordered path can.
--
-- NOTE: the admin_usage_paths definition below was superseded within the hour
-- by 20260720133108_fix_usage_paths_min_uuid.sql — the original used
-- min(user_id), and Postgres has no min() for uuid. Kept here as the historical
-- record of what was applied; the fix migration carries the working version.

create or replace function public.admin_usage_paths(p_days int default 30, p_steps int default 4, p_limit int default 25)
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
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_steps int := least(greatest(p_steps, 2), 8);
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  with ordered as (
    select
      e.session_id, e.user_id,
      regexp_replace(e.route, '/\([^)]*\)', '', 'g') as route,
      row_number() over (partition by e.session_id order by e.created_at) as rn,
      lag(regexp_replace(e.route, '/\([^)]*\)', '', 'g'))
        over (partition by e.session_id order by e.created_at) as prev_route
    from app_events e
    where e.created_at >= v_since
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
  where j.path like '%→%'
  group by j.path
  order by journeys desc
  limit greatest(p_limit, 1);
end;
$$;

-- Where visits begin. The first screen of a session is the entry point, and for
-- a mobile app that is usually either the launch screen or whatever a push
-- notification deep-linked into — which makes this the clearest read on whether
-- notifications are landing people where they were meant to go.
create or replace function public.admin_usage_entries(p_days int default 30)
returns table (
  route    text,
  entries  bigint,
  users    bigint
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
  with firsts as (
    select distinct on (e.session_id)
      e.session_id, e.user_id,
      regexp_replace(e.route, '/\([^)]*\)', '', 'g') as route
    from app_events e
    where e.created_at >= v_since
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

-- Normalise the group syntax in the flow RPC too, so the graph and the paths
-- agree about what a screen is called.
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
      regexp_replace(e.route, '/\([^)]*\)', '', 'g') as from_route,
      lead(regexp_replace(e.route, '/\([^)]*\)', '', 'g'))
        over (partition by e.session_id order by e.created_at) as to_route,
      e.user_id
    from app_events e
    where e.created_at >= v_since
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

revoke all on function public.admin_usage_paths(int, int, int) from public, anon;
revoke all on function public.admin_usage_entries(int) from public, anon;
grant execute on function public.admin_usage_paths(int, int, int) to authenticated;
grant execute on function public.admin_usage_entries(int) to authenticated;
