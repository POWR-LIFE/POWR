-- admin_usage_paths threw "function min(uuid) does not exist" — Postgres has no
-- min/max for uuid, and the previous definition reached for min(user_id) to
-- collapse a session down to one row. A session belongs to exactly one member
-- anyway, so the aggregate was never needed: group by the user alongside the
-- session and the column comes through untouched.
--
-- Worth noting how this surfaced. The admin page fired all seven usage RPCs in
-- one Promise.all and threw on the first error, so this single broken query
-- blanked the entire panel — every KPI read zero and the page looked like "no
-- data has ever been collected" rather than "one query is broken". The page now
-- fails soft per query and names the failures, which is the more important fix.

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
      e.session_id,
      e.user_id,
      regexp_replace(e.route, '/\([^)]*\)', '', 'g') as route,
      row_number() over (partition by e.session_id order by e.created_at) as rn,
      lag(regexp_replace(e.route, '/\([^)]*\)', '', 'g'))
        over (partition by e.session_id order by e.created_at) as prev_route
    from app_events e
    where e.created_at >= v_since
      and e.event_type = 'screen_view'
      and e.route is not null
  ),
  -- Consecutive repeats collapse first: expo-router re-emits a path on
  -- param-only changes, and 'Home → Home → Rewards' is the same journey as
  -- 'Home → Rewards' to anyone reading this.
  deduped as (
    select session_id, user_id, route,
           row_number() over (partition by session_id order by rn) as step
    from ordered
    where prev_route is null or prev_route is distinct from route
  ),
  joined as (
    select
      session_id,
      user_id,
      string_agg(route, '  →  ' order by step) as path
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

revoke all on function public.admin_usage_paths(int, int, int) from public, anon;
grant execute on function public.admin_usage_paths(int, int, int) to authenticated;
