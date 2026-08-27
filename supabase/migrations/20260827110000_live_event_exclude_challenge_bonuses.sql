-- Live events: challenge bonuses do not count toward the event score.
--
-- 2026-08-27, FNL x POWR day 1: Tegan joined at 10:22Z with a Garmin; the Terra
-- 7-day backfill credited a week of history at 10:25:21–25 and the weekly
-- challenge evaluator, running one second later, unlocked "10km Ride" (+20) and
-- "Just Run" (+15) off the 21–26 Aug sessions. The scorer's sessionless branch
-- anchored those bonuses to today's swim + HIIT (credited moments earlier) and
-- put her on the board at 65 with 30 of real in-window activity.
--
-- A challenge payout is a sessionless row: nothing on it says WHICH sessions
-- completed it, so "inside the window" cannot be verified. Rather than guess,
-- the event score is activity points only — session-backed earns (activity
-- overlap), streak bonuses (if the event counts them), and admin
-- adjustments/penalties. Weekly and shared challenge payouts still land in the
-- member's wallet as before; they just don't move the event board.
--
-- Same rule for every consumer: _live_event_scores, _live_event_user_points,
-- get_event_leaderboard, admin_get_event_leaderboard and settle all read
-- _live_event_counted, so the number a member watches during the week is the
-- number that settles.

create or replace function public._live_event_counted(p_event_id uuid, p_uid uuid default null)
returns table(user_id uuid, amount integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select * from public.live_events where id = p_event_id
  ),
  rows as (
    select pt.user_id, pt.amount, pt.type, pt.source, pt.created_at,
           s.id                              as session_id,
           s.type::text                      as s_type,
           s.verification::text              as s_verif,
           s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at
    from public.point_transactions pt
    left join public.activity_sessions s on s.id = pt.session_id
    where (p_uid is null or pt.user_id = p_uid)
  ),
  sess as (
    -- session-backed: in the window when the ACTIVITY overlaps it
    select r.user_id, r.amount, r.ended_at as counted_at, r.created_at
    from rows r
    cross join ev
    where r.session_id is not null
      and r.ended_at   >  ev.window_start_at
      and r.started_at <  ev.window_end_at
      and (
        (r.type = 'streak' and ev.count_streak)
        or (
          r.type = 'earn'
          and (ev.count_manual  or coalesce(r.s_verif, '') <> 'manual')
          and (ev.count_manual  or coalesce(r.source, '')  <> 'manual_log')
          and (ev.count_walking or coalesce(r.s_type, '')  <> 'walking')
          and (ev.included_activities is null
               or r.s_type = any (ev.included_activities))
        )
      )
  ),
  other as (
    -- sessionless: credited in the window, and (for bonuses) anchored to
    -- in-window activity the user had already banked. Challenge payouts are
    -- excluded outright: they carry no session, so the activity that earned
    -- them cannot be placed inside the window (see header).
    select r.user_id, r.amount, r.created_at as counted_at
    from rows r
    cross join ev
    where r.session_id is null
      and r.created_at >= ev.window_start_at
      and r.created_at <  ev.window_end_at
      and coalesce(r.source, '') not in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
      and (
        r.type in ('adjustment', 'penalty')
        or (
          (r.type = 'earn' or (r.type = 'streak' and ev.count_streak))
          and exists (
            select 1 from sess x
            where x.user_id = r.user_id and x.created_at <= r.created_at
          )
        )
      )
  )
  select user_id, amount, counted_at from sess
  union all
  select user_id, amount, counted_at from other
$$;
