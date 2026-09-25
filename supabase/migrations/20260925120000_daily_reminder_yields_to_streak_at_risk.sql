-- The morning daily_reminder and the evening streak_at_risk share ONE
-- nudge-class slot per user per local day (system_config.nudge_daily_cap = 1,
-- enforced in send-push-notification). The reminder fires first, so for a
-- user with a live streak it spent the slot every morning and the far more
-- specific evening warning was skipped as `nudge_budget` — 82 skips across 32
-- users in the 30 days to 2026-09-25, against 34 sent.
--
-- Fix: the reminder yields. A user whose streak is long enough to earn the
-- evening warning (non-manual activity on each of the last
-- streak_at_risk_min_streak local days, ending yesterday) is not a reminder
-- candidate — they get the streak push at 20:00 if the day stays empty, and
-- nothing at all if they were active, exactly as before. Users without such a
-- streak keep the morning reminder. The yield is conditional on the streak
-- push being able to fire at all: the user's streak_at_risk preference is on
-- and the type is not admin-disabled — otherwise the reminder stands, so no
-- one loses their only nudge.
--
-- send-push-notification keeps every gate it had (exact streak recompute,
-- min-streak floor, preference, budget); this only stops the reminder from
-- taking the slot the evening push needs.

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
     -- least min_streak days ending yesterday (local), pref on, type enabled.
     and not (
       cfg.streak_push_enabled
       and coalesce(np.streak_at_risk, true)
       and (
         select count(distinct (s.started_at at time zone u.tz)::date)
           from activity_sessions s
          where s.user_id = np.user_id
            and s.verification <> 'manual'
            and s.started_at >= now() - (cfg.min_streak + 1) * interval '1 day' - interval '2 hours'
            and (s.started_at at time zone u.tz)::date
                  between (now() at time zone u.tz)::date - cfg.min_streak
                      and (now() at time zone u.tz)::date - 1
       ) >= cfg.min_streak
     )
$function$;
