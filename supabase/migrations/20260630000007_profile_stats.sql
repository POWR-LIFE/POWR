-- ============================================================================
-- PROFILE STATS — server-computed stats for the public profile sheet.
--
-- activity_sessions / point_transactions / user_streaks are RLS-restricted to
-- the OWNER (auth.uid() = user_id). So the sheet's client-side reads returned
-- empty → zeros for everyone you weren't yourself (the stat strip, 7-day
-- sparkline, sessions, activity breakdown and achievement badge were all dead
-- when viewing another person — only ever right for yourself / as admin).
--
-- This SECURITY DEFINER RPC computes them server-side, bypassing RLS, for any
-- user. One call powers BOTH the stat strip/breakdown (fetchProfileStats) and
-- the earned-achievement count (fetchEarnedAchievementCount evaluates the raw
-- fields in TS via computeEarnedIds). Authenticated-only, anon revoked.
-- ============================================================================

create or replace function public.get_profile_stats(p_user_id uuid)
returns table (
  total_points          integer,
  current_streak        integer,
  longest_streak        integer,
  session_count_30d     integer,
  daily_points          integer[],
  activity_breakdown    jsonb,
  total_sessions        integer,
  sessions_per_type     jsonb,
  total_run_distance_km numeric,
  max_single_run_km     numeric,
  total_steps           numeric,
  max_single_day_steps  numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_user_id is null then
    return;
  end if;

  return query
  with
  pts as (
    select amount, created_at
    from public.point_transactions
    where user_id = p_user_id and type in ('earn', 'adjustment')
  ),
  -- 7 day-buckets, index 0 = oldest, 6 = today (matches client dailyPoints).
  daily as (
    select gs.d as day_idx,
           coalesce(sum(p.amount), 0)::int as pts
    from generate_series(0, 6) as gs(d)
    left join pts p
      on (current_date - (p.created_at at time zone 'UTC')::date) = (6 - gs.d)
    group by gs.d
  ),
  sess30 as (
    select type
    from public.activity_sessions
    where user_id = p_user_id and started_at >= now() - interval '30 days'
  ),
  breakdown as (
    select type, count(*)::int as cnt
    from sess30
    group by type
  ),
  allsess as (
    select type, distance_m, steps, started_at
    from public.activity_sessions
    where user_id = p_user_id
  ),
  per_type as (
    select type, count(*)::int as cnt
    from allsess
    group by type
  ),
  steps_by_day as (
    select (started_at at time zone 'UTC')::date as d, sum(coalesce(steps, 0)) as s
    from allsess
    where type = 'walking' and steps is not null
    group by 1
  ),
  streak as (
    select us.current_streak as cs, us.longest_streak as ls
    from public.user_streaks us
    where us.user_id = p_user_id
  )
  select
    (select coalesce(sum(amount), 0)::int from pts),
    (select coalesce(cs, 0) from streak),
    (select coalesce(ls, 0) from streak),
    (select count(*)::int from sess30),
    (select array_agg(pts order by day_idx) from daily),
    coalesce((
      select jsonb_agg(jsonb_build_object('type', type, 'count', cnt) order by cnt desc)
      from breakdown
    ), '[]'::jsonb),
    (select count(*)::int from allsess),
    coalesce((select jsonb_object_agg(type, cnt) from per_type), '{}'::jsonb),
    (select (coalesce(sum(distance_m) filter (where type = 'running'), 0) / 1000.0)::numeric from allsess),
    (select (coalesce(max(distance_m) filter (where type = 'running'), 0) / 1000.0)::numeric from allsess),
    (select coalesce(sum(s), 0)::numeric from steps_by_day),
    (select coalesce(max(s), 0)::numeric from steps_by_day);
end;
$$;

grant execute on function public.get_profile_stats(uuid) to authenticated;
revoke execute on function public.get_profile_stats(uuid) from public, anon;
