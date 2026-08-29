-- Live events: the `source <> 'manual_log'` check came back. Remove it again.
--
-- 2026-08-29, FNL x POWR day 3: Luke showed 2 pts on the board with a 47 km
-- ride (+10, verification = 'wearable') inside the window. Piers was down 12
-- the same way. Migration 20260827123000 (manual = VERIFICATION, never ledger
-- source — native HealthKit / Health Connect workouts are written through
-- logManualSession and carry source = 'manual_log' while verification is
-- 'health' / 'wearable') dropped the source check. The next day's
-- 20260828150000 rewrote _live_event_counted for the count_* toggles from the
-- older text and silently re-introduced the line, so with count_manual off
-- every Apple Health workout vanished from the board again.
--
-- This is the 20260828150000 body with that one line removed. Nothing else
-- changes; no results are frozen for the live event, so the corrected number
-- appears on the next poll. The scoring-breakdown migration that follows
-- (20260829120000) redefines this function without the line as well.

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
          -- "manual" = self-reported: the session's verification, never the
          -- ledger source (native HealthKit rows are source = 'manual_log').
          and (ev.count_manual  or coalesce(r.s_verif, '') <> 'manual')
          and (ev.count_walking or coalesce(r.s_type, '')  <> 'walking')
          and (ev.included_activities is null
               or r.s_type = any (ev.included_activities))
        )
      )
  ),
  other as (
    -- sessionless rows credited in the window. Which ones count is the
    -- event's choice, with two fixed rules the editor promises: penalties
    -- always reduce a score; invite rewards (and the attendance reward)
    -- never add to one.
    select r.user_id, r.amount, r.created_at as counted_at
    from rows r
    cross join ev
    where r.session_id is null
      and r.created_at >= ev.window_start_at
      and r.created_at <  ev.window_end_at
      and coalesce(r.source, '') not in
            ('referral_received', 'referral_sent', 'invite_milestone', 'event_attendance')
      and (
        r.type = 'penalty'
        or (r.type = 'adjustment' and ev.count_adjustments)
        or (coalesce(r.source, '') in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
            and ev.count_challenges)
        or (r.type = 'bonus' and ev.count_bonuses)
        or (
          -- sessionless earn / streak: anchored to in-window activity the
          -- member had already banked (unchanged)
          coalesce(r.source, '') not in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
          and (r.type = 'earn' or (r.type = 'streak' and ev.count_streak))
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
