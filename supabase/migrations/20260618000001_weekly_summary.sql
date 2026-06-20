-- =============================================================
-- WEEKLY SUMMARY EMAIL
-- A Monday-morning recap of the user's previous week: points earned
-- (with a week-over-week delta), workouts, active days, streak, top
-- activity and league finish.
--
--   1. notification_preferences.email_weekly_summary — per-user opt-out.
--   2. get_weekly_summary_recipients() — one query that aggregates the
--      completed week for every eligible, active user (service-role only).
--   3. pg_cron job → send-weekly-summary edge function every Monday 08:00 UTC.
-- =============================================================

create extension if not exists pg_cron;

-- ── 1. Opt-out preference ────────────────────────────────────
alter table public.notification_preferences
  add column if not exists email_weekly_summary boolean not null default true;

-- ── 2. Aggregation RPC ───────────────────────────────────────
-- Returns one row per eligible recipient for the window [p_since, p_until):
--   - opted in (email_weekly_summary), has an email, and was active
--     (earned points or logged a workout) during the window.
-- "Points" matches the weekly leaderboard definition (earn + adjustment).
-- Workouts and the top activity exclude sleep and walking (the auto-logged
-- baseline); active_days counts any non-sleep activity. Rank is within the
-- user's leaderboard cohort (pro vs non-pro), matching the in-app board.
create or replace function public.get_weekly_summary_recipients(
  p_since      timestamptz,
  p_until      timestamptz,
  p_prev_since timestamptz
)
returns table (
  user_id        uuid,
  email          text,
  display_name   text,
  referral_code  text,
  points         int,
  prev_points    int,
  workouts       int,
  active_days    int,
  distance_m     double precision,
  steps          int,
  top_type       text,
  top_count      int,
  current_streak int,
  weekly_rank    int,
  is_pro         boolean
)
language sql
security definer
set search_path = public
as $$
  with wk as (
    select pt.user_id, coalesce(sum(pt.amount), 0)::int as pts
    from public.point_transactions pt
    where pt.type in ('earn', 'adjustment')
      and pt.created_at >= p_since and pt.created_at < p_until
    group by pt.user_id
  ),
  prev as (
    select pt.user_id, coalesce(sum(pt.amount), 0)::int as pts
    from public.point_transactions pt
    where pt.type in ('earn', 'adjustment')
      and pt.created_at >= p_prev_since and pt.created_at < p_since
    group by pt.user_id
  ),
  sess as (
    select
      s.user_id,
      count(*) filter (where s.type not in ('sleep', 'walking'))                 as workouts,
      count(distinct ((s.started_at at time zone 'UTC')::date))
        filter (where s.type <> 'sleep')                                         as active_days,
      coalesce(sum(s.distance_m), 0)                                             as distance_m,
      coalesce(sum(s.steps), 0)::int                                            as steps
    from public.activity_sessions s
    where s.started_at >= p_since and s.started_at < p_until
      and coalesce(s.flagged, false) = false
    group by s.user_id
  ),
  top as (
    select user_id, type, cnt
    from (
      select
        s.user_id,
        s.type::text as type,
        count(*)::int as cnt,
        row_number() over (partition by s.user_id order by count(*) desc, s.type) as rn
      from public.activity_sessions s
      where s.started_at >= p_since and s.started_at < p_until
        and coalesce(s.flagged, false) = false
        and s.type not in ('sleep', 'walking')
      group by s.user_id, s.type
    ) t
    where rn = 1
  ),
  ranked as (
    select
      w.user_id,
      rank() over (partition by p.is_pro order by w.pts desc)::int as rnk
    from wk w
    join public.profiles p on p.id = w.user_id
    where p.show_on_leaderboard = true and w.pts > 0
  )
  select
    pr.id                              as user_id,
    u.email::text                      as email,
    pr.display_name,
    pr.referral_code,
    coalesce(wk.pts, 0)                as points,
    coalesce(prev.pts, 0)             as prev_points,
    coalesce(sess.workouts, 0)::int   as workouts,
    coalesce(sess.active_days, 0)::int as active_days,
    coalesce(sess.distance_m, 0)      as distance_m,
    coalesce(sess.steps, 0)::int      as steps,
    top.type                           as top_type,
    coalesce(top.cnt, 0)              as top_count,
    coalesce(st.current_streak, 0)    as current_streak,
    ranked.rnk                         as weekly_rank,
    pr.is_pro
  from public.profiles pr
  join auth.users u on u.id = pr.id
  left join wk    on wk.user_id    = pr.id
  left join prev  on prev.user_id  = pr.id
  left join sess  on sess.user_id  = pr.id
  left join top   on top.user_id   = pr.id
  left join public.user_streaks st on st.user_id = pr.id
  left join public.notification_preferences np on np.user_id = pr.id
  left join ranked on ranked.user_id = pr.id
  where u.email is not null
    and coalesce(np.email_weekly_summary, true) = true
    and (coalesce(wk.pts, 0) > 0 or coalesce(sess.workouts, 0) > 0);
$$;

revoke all on function public.get_weekly_summary_recipients(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
-- Service role only (it bypasses the revokes); the edge function calls this.

-- ── 3. Weekly cron → edge function ───────────────────────────
-- Mondays 08:00 UTC. Security: send-weekly-summary runs verify_jwt=false and
-- is gated by the x-weekly-token shared secret, read from Vault (secret name
-- 'weekly_token') so no literal lives in source or migrations.
do $job$
begin
  perform cron.unschedule('weekly-summary-email');
exception when others then
  null; -- job did not exist yet
end
$job$;

select cron.schedule(
  'weekly-summary-email',
  '0 8 * * 1',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-weekly-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-weekly-token', (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
