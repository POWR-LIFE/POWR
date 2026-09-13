-- =============================================================
-- GYM BOARDS — the community scene
--
-- Jamie (09-10): "what happens when we have 100 users, this page would not
-- make sense … how about collective data". Twelve individual session cards
-- stop meaning anything past a few dozen members; the gym's aggregate
-- numbers get MORE impressive as it grows. One RPC, one jsonb:
--
--   week      day-by-day points / sessions / minutes, this week and last,
--             on the board's week grid (Mon..Sun, local)
--   now       members checked in right now (open gym_visits), sessions and
--             points so far today
--   vs_last   this week vs last week, same weekday-to-now window
--   mix       activity types, last 28 days (what the gym earns on)
--   peak      busiest hour and weekday, last 28 days
--   streaks   members here this week on a 7+ day streak, and the longest
--   rank      this gym's weekly points rank among POWR gyms with any
--             counted points this week
--   all_time  sessions, hours, points, members — ever
--
-- Counts and sums only. The one member id it returns (longest streak) is
-- resolved and hashed by the edge fn like every other row.
-- =============================================================

create or replace function public._gym_board_community(p_partner_id uuid)
returns jsonb
language plpgsql
volatile   -- builds a temp table of the gym's counted sessions; STABLE would forbid the write
security definer
set search_path = public
as $$
declare
  v_tz         text;
  v_local_now  timestamp;
  v_week_start timestamptz;
  v_week_end   timestamptz;
  v_prev_start timestamptz;
  v_day_start  timestamptz;
  v_same_last  timestamptz;   -- the same moment last week
  v_week       jsonb;
  v_last       jsonb;
  v_now        jsonb;
  v_vs         jsonb;
  v_mix        jsonb;
  v_peak       jsonb;
  v_streaks    jsonb;
  v_rank       jsonb;
  v_all        jsonb;
begin
  select tz into v_tz from public.gym_boards where partner_id = p_partner_id;
  if not found then
    return null;
  end if;

  v_local_now  := now() at time zone v_tz;
  v_week_start := date_trunc('week', v_local_now) at time zone v_tz;
  v_week_end   := (date_trunc('week', v_local_now) + interval '7 days') at time zone v_tz;
  v_prev_start := (date_trunc('week', v_local_now) - interval '7 days') at time zone v_tz;
  v_day_start  := date_trunc('day', v_local_now) at time zone v_tz;
  v_same_last  := now() - interval '7 days';

  -- ── counted sessions at this gym, last 5 weeks (enough for every block) ──
  drop table if exists _gbc;
  create temp table _gbc on commit drop as
    select s.id, s.user_id, s.type::text as s_type, s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at,
           (coalesce(s.duration_sec,
                     greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at))) / 60)::integer as minutes,
           (s.started_at at time zone v_tz)             as local_start,
           sum(pt.amount)::integer                      as points
    from public.activity_sessions s
    join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
    join public.point_transactions pt
      on pt.session_id = s.id and pt.type in ('earn', 'adjustment', 'penalty')
    where s.partner_id = p_partner_id
      and coalesce(s.ended_at, s.started_at) >= now() - interval '35 days'
    group by s.id, s.user_id, s.type, s.started_at, s.ended_at, s.duration_sec;

  -- ── this week and last, day by day on the local grid ──
  with days as (
    select gs::date as d, (gs::timestamp at time zone v_tz) as d_start
    from generate_series(date_trunc('week', v_local_now), date_trunc('week', v_local_now) + interval '6 days', interval '1 day') gs
  )
  select jsonb_agg(jsonb_build_object(
           'date',     d.d,
           'points',   coalesce((select sum(greatest(c.points, 0)) from _gbc c where c.local_start::date = d.d), 0),
           'sessions', coalesce((select count(*) from _gbc c where c.local_start::date = d.d), 0),
           'minutes',  coalesce((select sum(c.minutes) from _gbc c where c.local_start::date = d.d), 0),
           'members',  coalesce((select count(distinct c.user_id) from _gbc c where c.local_start::date = d.d), 0)
         ) order by d.d)
    into v_week
  from days d;

  with days as (
    select gs::date as d
    from generate_series(date_trunc('week', v_local_now) - interval '7 days', date_trunc('week', v_local_now) - interval '1 day', interval '1 day') gs
  )
  select jsonb_agg(jsonb_build_object(
           'date',     d.d,
           'points',   coalesce((select sum(greatest(c.points, 0)) from _gbc c where c.local_start::date = d.d), 0),
           'sessions', coalesce((select count(*) from _gbc c where c.local_start::date = d.d), 0)
         ) order by d.d)
    into v_last
  from days d;

  -- ── right now / today ──
  select jsonb_build_object(
           'in_gym',   (select count(*) from public.gym_visits v
                         where v.partner_id = p_partner_id
                           and v.ended_at is null
                           and coalesce(v.status, '') not in ('closed', 'abandoned')
                           and v.started_at > now() - interval '6 hours'),
           'sessions', (select count(*) from _gbc c where c.ended_at >= v_day_start),
           'points',   coalesce((select sum(greatest(c.points, 0)) from _gbc c where c.ended_at >= v_day_start), 0),
           'members',  (select count(distinct c.user_id) from _gbc c where c.ended_at >= v_day_start),
           'minutes',  coalesce((select sum(c.minutes) from _gbc c where c.ended_at >= v_day_start), 0)
         )
    into v_now;

  -- ── this week so far vs the same stretch of last week ──
  select jsonb_build_object(
           'points',        coalesce((select sum(greatest(c.points, 0)) from _gbc c where c.ended_at >= v_week_start), 0),
           'points_last',   coalesce((select sum(greatest(c.points, 0)) from _gbc c where c.ended_at >= v_prev_start and c.ended_at < v_same_last), 0),
           'sessions',      (select count(*) from _gbc c where c.ended_at >= v_week_start),
           'sessions_last', (select count(*) from _gbc c where c.ended_at >= v_prev_start and c.ended_at < v_same_last),
           'members',       (select count(distinct c.user_id) from _gbc c where c.ended_at >= v_week_start),
           'members_last',  (select count(distinct c.user_id) from _gbc c where c.ended_at >= v_prev_start and c.ended_at < v_same_last)
         )
    into v_vs;

  -- ── what the gym earns on, last 28 days ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', m.s_type, 'sessions', m.n, 'points', m.pts, 'minutes', m.mins
         ) order by m.pts desc), '[]'::jsonb)
    into v_mix
  from (
    select c.s_type, count(*) as n, sum(greatest(c.points, 0)) as pts, sum(c.minutes) as mins
    from _gbc c where c.ended_at >= now() - interval '28 days'
    group by c.s_type
  ) m;

  -- ── when the gym is busiest, last 28 days ──
  select jsonb_build_object(
           'hour',    (select extract(hour from c.local_start)::integer from _gbc c
                        where c.ended_at >= now() - interval '28 days'
                        group by 1 order by count(*) desc, 1 limit 1),
           'weekday', (select extract(isodow from c.local_start)::integer from _gbc c
                        where c.ended_at >= now() - interval '28 days'
                        group by 1 order by count(*) desc, 1 limit 1),
           'by_hour', coalesce((select jsonb_agg(jsonb_build_object('hour', h.hr, 'sessions', h.n) order by h.hr)
                               from (select extract(hour from c.local_start)::integer as hr, count(*) as n
                                     from _gbc c where c.ended_at >= now() - interval '28 days'
                                     group by 1) h), '[]'::jsonb)
         )
    into v_peak;

  -- ── streaks among members here this week ──
  with here as (
    select distinct c.user_id from _gbc c where c.ended_at >= v_week_start
  ),
  st as (
    select h.user_id, public._gym_board_streak(h.user_id) as streak from here h
  )
  select jsonb_build_object(
           'on_7plus', (select count(*) from st where streak >= 7),
           'on_30plus', (select count(*) from st where streak >= 30),
           'longest',  (select jsonb_build_object('user_id', s.user_id, 'streak', s.streak)
                        from st s where s.streak > 0 order by s.streak desc, s.user_id limit 1)
         )
    into v_streaks;

  -- ── this gym among POWR gyms this week ──
  with gyms as (
    select s.partner_id, sum(pt.amount) as pts
    from public.point_transactions pt
    join public.activity_sessions s on s.id = pt.session_id
    join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
    where s.partner_id is not null
      and pt.type in ('earn', 'adjustment', 'penalty')
      and coalesce(s.ended_at, s.started_at) >= v_week_start
      and s.started_at < v_week_end
    group by s.partner_id
    having sum(pt.amount) > 0
  ),
  ranked as (
    select partner_id, pts, rank() over (order by pts desc, partner_id) as rk, count(*) over () as total
    from gyms
  )
  select coalesce((select jsonb_build_object('rank', r.rk, 'of', r.total, 'points', r.pts) from ranked r where r.partner_id = p_partner_id),
                  jsonb_build_object('rank', null, 'of', (select count(*) from gyms), 'points', 0))
    into v_rank;

  -- ── all time ──
  select jsonb_build_object(
           'sessions', count(*),
           'minutes',  coalesce(sum((coalesce(s.duration_sec,
                          greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at))) / 60)::integer), 0),
           'members',  count(distinct s.user_id),
           'points',   coalesce((select sum(pt.amount) from public.point_transactions pt
                                  join public.activity_sessions x on x.id = pt.session_id
                                  where x.partner_id = p_partner_id and pt.type in ('earn', 'adjustment', 'penalty')), 0),
           'since',    min(s.started_at)
         )
    into v_all
  from public.activity_sessions s
  join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
  where s.partner_id = p_partner_id;

  drop table if exists _gbc;

  return jsonb_build_object(
    'tz',        v_tz,
    'week',      coalesce(v_week, '[]'::jsonb),
    'last_week', coalesce(v_last, '[]'::jsonb),
    'now',       v_now,
    'vs_last',   v_vs,
    'mix',       v_mix,
    'peak',      v_peak,
    'streaks',   v_streaks,
    'rank',      v_rank,
    'all_time',  v_all
  );
end;
$$;

revoke all on function public._gym_board_community(uuid) from public, anon, authenticated;
grant execute on function public._gym_board_community(uuid) to service_role;
