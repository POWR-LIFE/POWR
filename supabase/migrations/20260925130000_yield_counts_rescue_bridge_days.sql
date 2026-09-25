-- Follow-up to 20260925120000 (PR #491 review): the daily_reminder yield
-- counted activity-session dates only, but the canonical streak recompute
-- (_shared/streak.ts, used by send-push-notification's min-streak floor)
-- also counts a COMPLETED streak rescue's missed_day as an active day. A user
-- rescued inside the window therefore looked one day short here, kept the
-- morning reminder, spent the slot, and lost the evening push the sender
-- would have approved. Count the same day set the sender counts.

create or replace function public.nudge_dispatch_candidates()
returns table(user_id uuid, kind text)
language sql
security definer
set search_path to 'public'
as $function$
  with u as (
    select p.id, coalesce(nullif(p.timezone, ''), 'Europe/London') as tz
      from profiles p
  ),
  cfg as (
    select coalesce(
             (select nullif(value, '')::int from system_config where key = 'streak_at_risk_min_streak'),
             3) as min_streak,
           coalesce(
             (select enabled from notification_config where type = 'streak_at_risk'),
             true) as streak_push_enabled
  )
  select u.id, 'streak_at_risk'::text
    from u
   where (now() at time zone u.tz)::time >= time '20:00'
     and (now() at time zone u.tz)::time <  time '20:15'
     and exists (
       select 1 from activity_sessions s
        where s.user_id = u.id
          and s.verification <> 'manual'
          and s.started_at >= now() - interval '50 hours'
          and (s.started_at at time zone u.tz)::date = (now() at time zone u.tz)::date - 1)
     and not exists (
       select 1 from activity_sessions s
        where s.user_id = u.id
          and s.verification <> 'manual'
          and s.started_at >= now() - interval '26 hours'
          and (s.started_at at time zone u.tz)::date = (now() at time zone u.tz)::date)
  union all
  select np.user_id, 'daily_reminder'::text
    from notification_preferences np
    join u on u.id = np.user_id
    cross join cfg
   where np.daily_reminder = true
     and (now() at time zone u.tz)::time >= make_time(np.daily_reminder_hour, np.daily_reminder_minute, 0)
     and (now() at time zone u.tz)::time <  make_time(np.daily_reminder_hour, np.daily_reminder_minute, 0) + interval '15 minutes'
     and not exists (
       select 1 from activity_sessions s
        where s.user_id = np.user_id
          and s.verification <> 'manual'
          and s.started_at >= now() - interval '26 hours'
          and (s.started_at at time zone u.tz)::date = (now() at time zone u.tz)::date)
     -- Yield to tonight's streak_at_risk when it can fire: a streak of at
     -- least min_streak days ending yesterday (local) — session days plus
     -- completed rescue bridge days, as the sender counts them — pref on,
     -- type enabled.
     and not (
       cfg.streak_push_enabled
       and coalesce(np.streak_at_risk, true)
       and (
         select count(distinct d.day)
           from (
             select (s.started_at at time zone u.tz)::date as day
               from activity_sessions s
              where s.user_id = np.user_id
                and s.verification <> 'manual'
                and s.started_at >= now() - (cfg.min_streak + 1) * interval '1 day' - interval '2 hours'
             union all
             select r.missed_day
               from streak_rescues r
              where r.user_id = np.user_id
                and r.status = 'completed'
                and r.missed_day >= (now() at time zone u.tz)::date - cfg.min_streak
           ) d
          where d.day between (now() at time zone u.tz)::date - cfg.min_streak
                          and (now() at time zone u.tz)::date - 1
       ) >= cfg.min_streak
     )
$function$;
