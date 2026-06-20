-- =============================================================
-- WEEKLY SUMMARY EMAIL — richer recap
-- Extends get_weekly_summary_recipients() (migration 20260618000001)
-- with the data needed for a fuller, more visual weekly email:
--   - gyms visited this week (name + check-in count)
--   - longest workout (duration, type, gym)
--   - connected wearable / health source
--   - challenges completed this week (count + ids → titled in the edge fn)
--   - current POWR balance + the highest-value reward it unlocks
--
-- The return type grows, so the function is dropped and recreated
-- (create-or-replace cannot change a function's OUT columns).
-- The email_weekly_summary column and the pg_cron job are unchanged.
-- =============================================================

drop function if exists public.get_weekly_summary_recipients(timestamptz, timestamptz, timestamptz);

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
  is_pro         boolean,
  -- ── richer fields ──────────────────────────────────────────
  prev_steps     int,        -- previous week's total steps (for the steps delta)
  activities     jsonb,      -- [{ type, count, prevCount }] per-activity breakdown
  longest_sec    int,        -- longest single workout this week (sec)
  longest_type   text,       -- its activity type
  longest_partner text,      -- gym name, if it was a check-in
  gyms           jsonb,      -- [{ name, count }] top gyms visited this week
  wearable       text,       -- active health provider / wearable slug
  challenges     int,        -- challenges completed this week
  challenge_ids  text[],     -- their ids (titled by the edge function)
  balance        int,        -- current spendable POWR balance
  reward_title   text,       -- highest-value reward the balance unlocks
  reward_brand   text,
  reward_cost    int,
  reward_image   text,
  reward_value   text
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
  -- Previous week's total steps — paired with sess.steps for the steps delta.
  prev_sess as (
    select s.user_id, coalesce(sum(s.steps), 0)::int as steps
    from public.activity_sessions s
    where s.started_at >= p_prev_since and s.started_at < p_since
      and coalesce(s.flagged, false) = false
    group by s.user_id
  ),
  -- Per-activity session counts (this week + last week) for the email's "how you
  -- moved" breakdown rows. Walking & sleep are excluded — walking is surfaced via
  -- the separate steps row; sleep isn't a workout.
  act as (
    select
      s.user_id,
      s.type::text as type,
      count(*) filter (where s.started_at >= p_since      and s.started_at < p_until)::int as cnt,
      count(*) filter (where s.started_at >= p_prev_since and s.started_at < p_since)::int as prev_cnt
    from public.activity_sessions s
    where s.started_at >= p_prev_since and s.started_at < p_until
      and coalesce(s.flagged, false) = false
      and s.type not in ('sleep', 'walking')
    group by s.user_id, s.type
  ),
  act_agg as (
    select
      user_id,
      jsonb_agg(
        jsonb_build_object('type', type, 'count', cnt, 'prevCount', prev_cnt)
        order by cnt desc, type
      ) filter (where cnt > 0) as activities
    from act
    group by user_id
  ),
  -- Longest single workout (excludes sleep & walking — the auto-logged baseline).
  longest as (
    select distinct on (s.user_id)
      s.user_id,
      s.duration_sec::int as sec,
      s.type::text        as type,
      p.name              as partner
    from public.activity_sessions s
    left join public.partners p on p.id = s.partner_id
    where s.started_at >= p_since and s.started_at < p_until
      and coalesce(s.flagged, false) = false
      and s.type not in ('sleep', 'walking')
      and s.duration_sec is not null
    order by s.user_id, s.duration_sec desc nulls last, s.started_at desc
  ),
  -- Gyms visited this week (partner check-ins), top 3 by count.
  gym_ranked as (
    select
      s.user_id,
      p.name as gym_name,
      count(*)::int as cnt,
      row_number() over (partition by s.user_id order by count(*) desc, p.name) as rn
    from public.activity_sessions s
    join public.partners p on p.id = s.partner_id
    where s.started_at >= p_since and s.started_at < p_until
      and coalesce(s.flagged, false) = false
    group by s.user_id, p.name
  ),
  gym_agg as (
    select
      user_id,
      jsonb_agg(jsonb_build_object('name', gym_name, 'count', cnt) order by cnt desc, gym_name)
        filter (where rn <= 3) as gyms
    from gym_ranked
    group by user_id
  ),
  -- Challenges completed in the window.
  chal as (
    select
      ucc.user_id,
      count(*)::int as cnt,
      array_agg(ucc.challenge_id order by ucc.completed_at) as ids
    from public.user_challenge_completions ucc
    where ucc.completed_at >= p_since and ucc.completed_at < p_until
    group by ucc.user_id
  ),
  -- Current spendable balance across all transaction types (redeem is negative).
  bal as (
    select pt.user_id, coalesce(sum(pt.amount), 0)::int as bal
    from public.point_transactions pt
    group by pt.user_id
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
    pr.is_pro,
    coalesce(prev_sess.steps, 0)::int as prev_steps,
    act_agg.activities                 as activities,
    longest.sec                        as longest_sec,
    longest.type                       as longest_type,
    longest.partner                    as longest_partner,
    gym_agg.gyms                       as gyms,
    -- Prefer a connected dedicated wearable (Whoop, Garmin, Oura…) over the phone
    -- health aggregator. A user can have both — e.g. Whoop via Terra while their
    -- phone source is apple-health — and the wearable is the more meaningful badge.
    coalesce(
      (select lower(tc.provider)
         from public.terra_connections tc
        where tc.user_id = pr.id and tc.deauthed_at is null
        order by tc.last_event_at desc nulls last
        limit 1),
      pr.active_health_provider
    )                                  as wearable,
    coalesce(chal.cnt, 0)             as challenges,
    chal.ids                           as challenge_ids,
    coalesce(bal.bal, 0)              as balance,
    rw.title                           as reward_title,
    rw.brand_name                      as reward_brand,
    rw.powr_cost                       as reward_cost,
    rw.image                           as reward_image,
    rw.value_label                     as reward_value
  from public.profiles pr
  join auth.users u on u.id = pr.id
  left join wk      on wk.user_id      = pr.id
  left join prev    on prev.user_id    = pr.id
  left join sess      on sess.user_id      = pr.id
  left join prev_sess on prev_sess.user_id = pr.id
  left join act_agg   on act_agg.user_id   = pr.id
  left join top       on top.user_id       = pr.id
  left join longest on longest.user_id = pr.id
  left join gym_agg on gym_agg.user_id = pr.id
  left join chal    on chal.user_id    = pr.id
  left join bal     on bal.user_id     = pr.id
  left join public.user_streaks st on st.user_id = pr.id
  left join public.notification_preferences np on np.user_id = pr.id
  left join ranked on ranked.user_id = pr.id
  -- Highest-value active reward the user's balance already unlocks.
  left join lateral (
    select
      r.title,
      r.brand_name,
      r.powr_cost,
      coalesce(r.hero_image_url, r.image_url) as image,
      r.value_label
    from public.rewards r
    where r.active = true
      and r.powr_cost is not null
      and r.powr_cost > 0
      and r.powr_cost <= coalesce(bal.bal, 0)
      and (r.stock is null or r.stock > 0)
      and (r.expires_at is null or r.expires_at > now())
    order by r.powr_cost desc, r.sort_order asc nulls last
    limit 1
  ) rw on true
  where u.email is not null
    and coalesce(np.email_weekly_summary, true) = true
    and (coalesce(wk.pts, 0) > 0 or coalesce(sess.workouts, 0) > 0);
$$;

revoke all on function public.get_weekly_summary_recipients(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
-- Service role only (it bypasses the revokes); the edge function calls this.
