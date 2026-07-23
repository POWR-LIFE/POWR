-- Fix: active_days rescue progress bucketed by UTC calendar date, but the
-- offer's count_from anchors at the user's LOCAL midnight — a single local
-- day can span two UTC dates (e.g. Sydney), letting two same-day workouts
-- read as two "active days" and complete the requirement early.
--
-- Bucket in 24h windows anchored at p_from instead: day N = [p_from + N*24h,
-- p_from + (N+1)*24h). No timezone arithmetic, correct for every offset, and
-- DST drift is bounded to ±1h at the bucket edge (far better than ±14h).

create or replace function public.streak_rescue_requirement_progress(
  p_user uuid, p_from timestamptz, p_requirement text
) returns int
language sql
stable
security definer
set search_path = public
as $$
  select case p_requirement
    when 'gym_sessions' then (
      select count(*)::int from activity_sessions
       where user_id = p_user and verification <> 'manual'
         and type = 'gym' and started_at >= p_from)
    when 'active_days' then (
      select count(distinct floor(extract(epoch from (started_at - p_from)) / 86400))::int
        from activity_sessions
       where user_id = p_user and verification <> 'manual'
         and started_at >= p_from)
    when 'steps' then (
      select coalesce(sum(steps), 0)::int from activity_sessions
       where user_id = p_user and verification <> 'manual'
         and started_at >= p_from)
    else (
      select count(*)::int from activity_sessions
       where user_id = p_user and verification <> 'manual'
         and started_at >= p_from)
  end
$$;
