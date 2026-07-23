-- NUDGE DISPATCH CRONS
--
-- Two cron-driven edge functions, both token-gated with the shared
-- x-resolve-token secret (dispatch-scheduled-broadcasts pattern):
--
--   dispatch-daily-nudges  (*/15) — streak_at_risk in the user's local
--     20:00–20:15 window + daily_reminder at each user's chosen local time.
--     Candidate selection lives in SQL below; send-push-notification then
--     applies its own gates (admin kill-switch, nudge budget, prefs, streak
--     recompute) per user, so the dispatcher stays dumb.
--
--   streak-rescue-sweep    (hourly) — offers rescues for streaks that died
--     yesterday (local 09:00–10:00 window) and expires overdue offers.
--
-- Timezone note: profiles.timezone is IANA (written by the app from Intl) and
-- nullable — NULL/'' coalesces to Europe/London, same convention as the
-- scheduled-broadcast fan-out.

-- ── Candidates: streak at risk + daily reminder ──────────────────────────────
-- streak_at_risk: last active (non-manual) day is exactly yesterday-local and
-- nothing yet today → the streak dies at their midnight. The 50h started_at
-- bound keeps the EXISTS probes on the (user_id, started_at) index.
-- daily_reminder: pref enabled, chosen local time falls in the current 15-min
-- tick, and the user hasn't logged anything today (a "time to move" reminder
-- after they already moved is noise).

create or replace function public.nudge_dispatch_candidates()
returns table (user_id uuid, kind text)
language sql
security definer
set search_path = public
as $$
  with u as (
    select p.id, coalesce(nullif(p.timezone, ''), 'Europe/London') as tz
      from profiles p
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
   where np.daily_reminder = true
     and (now() at time zone u.tz)::time >= make_time(np.daily_reminder_hour, np.daily_reminder_minute, 0)
     and (now() at time zone u.tz)::time <  make_time(np.daily_reminder_hour, np.daily_reminder_minute, 0) + interval '15 minutes'
     and not exists (
       select 1 from activity_sessions s
        where s.user_id = np.user_id
          and s.verification <> 'manual'
          and s.started_at >= now() - interval '26 hours'
          and (s.started_at at time zone u.tz)::date = (now() at time zone u.tz)::date)
$$;

revoke all on function public.nudge_dispatch_candidates() from public, anon, authenticated;

-- ── Candidates: streak rescue sweep ──────────────────────────────────────────
-- A streak "died yesterday" = active on the day before yesterday, silent
-- yesterday. The sweep runs in the local-morning window so the offer lands at
-- breakfast, not 00:01. Cooldown counts from the last offer of ANY status so
-- expired offers can't be re-farmed. Run-length + min-streak checks happen in
-- the edge function (it needs the 90-day session walk anyway).

create or replace function public.streak_rescue_candidates()
returns table (user_id uuid, tz text, missed_day date)
language sql
security definer
set search_path = public
as $$
  with u as (
    select p.id, coalesce(nullif(p.timezone, ''), 'Europe/London') as tz
      from profiles p
  )
  select u.id, u.tz, ((now() at time zone u.tz)::date - 1) as missed_day
    from u
   where (select coalesce(value, 'true') from system_config where key = 'streak_rescue_enabled') = 'true'
     and (now() at time zone u.tz)::time >= time '09:00'
     and (now() at time zone u.tz)::time <  time '10:00'
     and not exists (
       select 1 from activity_sessions s
        where s.user_id = u.id
          and s.verification <> 'manual'
          and s.started_at >= now() - interval '50 hours'
          and (s.started_at at time zone u.tz)::date = (now() at time zone u.tz)::date - 1)
     and exists (
       select 1 from activity_sessions s
        where s.user_id = u.id
          and s.verification <> 'manual'
          and s.started_at >= now() - interval '74 hours'
          and (s.started_at at time zone u.tz)::date = (now() at time zone u.tz)::date - 2)
     and not exists (
       select 1 from streak_rescues r
        where r.user_id = u.id
          and r.offered_at > now() - make_interval(days =>
            coalesce((select nullif(regexp_replace(value, '\D', '', 'g'), '')::int
                        from system_config where key = 'streak_rescue_cooldown_days'), 30)))
$$;

revoke all on function public.streak_rescue_candidates() from public, anon, authenticated;

-- ── Cron schedules ───────────────────────────────────────────────────────────
create extension if not exists pg_cron;

do $job$
begin
  perform cron.unschedule('dispatch-daily-nudges');
exception when others then null;
end
$job$;

select cron.schedule(
  'dispatch-daily-nudges',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/dispatch-daily-nudges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

do $job$
begin
  perform cron.unschedule('streak-rescue-sweep');
exception when others then null;
end
$job$;

select cron.schedule(
  'streak-rescue-sweep',
  '5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/streak-rescue-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
