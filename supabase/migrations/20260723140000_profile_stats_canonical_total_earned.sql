-- ============================================================================
-- PROFILE STATS — add canonical total_earned (level basis).
--
-- get_profile_stats.total_points = sum(amount) WHERE type IN ('earn','adjustment')
-- (20260630000007). That DROPS positive 'streak'/'bonus' ledger rows AND all
-- vault, so it is strictly below the canonical lifetime-earned figure the rest
-- of the app derives level from:
--   get_my_points_summary.total_earned = sum(positive point_transactions, ALL
--   types) + sum(unreleased vault_deposits)   (20260718000001).
--
-- Consequence: the profile sheet's level pill / tier / avatar ring
-- (UserProfileSheet) and the level-gated achievement count
-- (fetchEarnedAchievementCount) rendered a LOWER level than the home screen and
-- the server-side level_up push for any user holding streak/bonus/vault credit.
-- e.g. a user at 498 earn + 11 streak + 10 vault shows Level 1 on their profile
-- but Level 2 everywhere else.
--
-- Fix: return an additional total_earned that mirrors the canonical basis.
-- total_points is intentionally left unchanged (the stat strip / 7-day sparkline
-- keep their existing meaning); only the client's LEVEL derivation moves onto
-- total_earned. Return signature changes, so drop before recreate.
-- ============================================================================

drop function if exists public.get_profile_stats(uuid);

create or replace function public.get_profile_stats(p_user_id uuid)
returns table (
  total_points          integer,
  total_earned          bigint,
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
  -- Canonical lifetime-earned basis, matching get_my_points_summary.total_earned:
  -- every positive ledger row (ALL types — streak/bonus included) plus vault
  -- POWR still counting toward level (unreleased). Released deposits are excluded
  -- here because release writes a positive 'vault_release' ledger row that
  -- earned_pos already counts.
  earned_pos as (
    select coalesce(sum(amount) filter (where amount > 0), 0)::bigint as pos
    from public.point_transactions
    where user_id = p_user_id
  ),
  vault_pend as (
    select coalesce(sum(amount), 0)::bigint as pending
    from public.vault_deposits
    where user_id = p_user_id and released_at is null
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
    ((select pos from earned_pos) + (select pending from vault_pend))::bigint,
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
