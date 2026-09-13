-- =============================================================
-- GYM BOARDS — beyond the gym
--
-- Jamie (09-10): "how we can add other activity data, like walking and
-- running". The wall only ever saw geofenced sessions inside the gym. This
-- widens it: the gym's MEMBERS (anyone with a session here in the last
-- 28 days) and everything those members do, anywhere — walks, runs, rides,
-- swims, HIIT, gym sessions elsewhere. Aggregates only: totals per activity
-- and per day, plus the longest run / ride / swim as a callout (distance
-- and time, never a route). Sleep and manual logs never count.
--
-- Distance: distance_m when the source gave one; a walking session with
-- steps but no distance (Health Connect today) is estimated at 0.75 m per
-- step. Per-session caps stop one bad row (a 243 km "ride", a 12 h "gym
-- session") from owning the wall: 300 km, 100k steps, 6 h.
-- =============================================================

create or replace function public._gym_board_beyond(p_partner_id uuid)
returns jsonb
language plpgsql
volatile   -- temp table, same reason as _gym_board_community
security definer
set search_path = public
as $$
declare
  v_tz         text;
  v_local_now  timestamp;
  v_week_start timestamptz;
  v_week_end   timestamptz;
  v_prev_start timestamptz;
  v_members    integer;
  v_week       jsonb;
  v_month      jsonb;
  v_days       jsonb;
  v_totals     jsonb;
  v_longest    jsonb;
begin
  select tz into v_tz from public.gym_boards where partner_id = p_partner_id;
  if not found then
    return null;
  end if;

  v_local_now  := now() at time zone v_tz;
  v_week_start := date_trunc('week', v_local_now) at time zone v_tz;
  v_week_end   := (date_trunc('week', v_local_now) + interval '7 days') at time zone v_tz;
  v_prev_start := (date_trunc('week', v_local_now) - interval '7 days') at time zone v_tz;

  -- the gym's members: trained here in the last 28 days, visible on boards
  drop table if exists _gbm;
  create temp table _gbm on commit drop as
    select distinct s.user_id
    from public.activity_sessions s
    join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
    where s.partner_id = p_partner_id
      and s.started_at >= now() - interval '28 days';
  select count(*) into v_members from _gbm;

  -- everything those members did, last 28 days, with caps applied per row
  drop table if exists _gbb;
  create temp table _gbb on commit drop as
    select s.id, s.user_id, s.type::text as s_type, s.started_at,
           (s.started_at at time zone v_tz)::date as local_day,
           (s.partner_id = p_partner_id)          as here,
           least(360, (coalesce(s.duration_sec,
                 greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at))) / 60))::integer as minutes,
           least(100000, coalesce(s.steps, 0))::integer as steps,
           least(300.0, case
             when coalesce(s.distance_m, 0) > 0 then s.distance_m / 1000.0
             when s.type = 'walking' and coalesce(s.steps, 0) > 0 then least(100000, s.steps) * 0.00075
             else 0 end)::numeric(10,2) as km,
           (coalesce(s.distance_m, 0) > 0) as km_measured
    from public.activity_sessions s
    join _gbm m on m.user_id = s.user_id
    where s.type <> 'sleep'
      and s.verification <> 'manual'
      and s.started_at >= now() - interval '28 days';

  -- per activity, this week
  select coalesce(jsonb_agg(jsonb_build_object(
           'type',        t.s_type,
           'sessions',    t.n,
           'members',     t.members,
           'minutes',     t.minutes,
           'km',          t.km,
           'km_measured', t.km_measured,
           'steps',       t.steps,
           'here_minutes', t.here_minutes,
           'longest_km',  t.longest_km,
           'longest_minutes', t.longest_minutes
         ) order by t.n desc), '[]'::jsonb)
    into v_week
  from (
    select b.s_type, count(*) as n, count(distinct b.user_id) as members,
           sum(b.minutes) as minutes, sum(b.km) as km, bool_or(b.km_measured) as km_measured,
           sum(b.steps) as steps,
           sum(case when b.here then b.minutes else 0 end) as here_minutes,
           max(b.km) as longest_km, max(b.minutes) as longest_minutes
    from _gbb b where b.started_at >= v_week_start
    group by b.s_type
  ) t;

  -- per activity, last 28 days
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', t.s_type, 'sessions', t.n, 'members', t.members,
           'minutes', t.minutes, 'km', t.km, 'steps', t.steps
         ) order by t.n desc), '[]'::jsonb)
    into v_month
  from (
    select b.s_type, count(*) as n, count(distinct b.user_id) as members,
           sum(b.minutes) as minutes, sum(b.km) as km, sum(b.steps) as steps
    from _gbb b group by b.s_type
  ) t;

  -- the week day by day, sessions by type + km
  with days as (
    select gs::date as d
    from generate_series(date_trunc('week', v_local_now), date_trunc('week', v_local_now) + interval '6 days', interval '1 day') gs
  )
  select jsonb_agg(jsonb_build_object(
           'date',     d.d,
           'sessions', coalesce((select count(*) from _gbb b where b.local_day = d.d), 0),
           'km',       coalesce((select sum(b.km) from _gbb b where b.local_day = d.d), 0),
           'minutes',  coalesce((select sum(b.minutes) from _gbb b where b.local_day = d.d), 0),
           'by_type',  coalesce((select jsonb_object_agg(x.s_type, x.n)
                                 from (select b.s_type, count(*) as n from _gbb b where b.local_day = d.d group by b.s_type) x),
                                '{}'::jsonb)
         ) order by d.d)
    into v_days
  from days d;

  -- totals: this week, the same stretch of last week (so a Thursday compares
  -- Mon..Thu with Mon..Thu, never a half week against a whole one), last 28 days
  select jsonb_build_object(
           'week', jsonb_build_object(
             'sessions', (select count(*) from _gbb where started_at >= v_week_start),
             'members',  (select count(distinct user_id) from _gbb where started_at >= v_week_start),
             'minutes',  coalesce((select sum(minutes) from _gbb where started_at >= v_week_start), 0),
             'km',       coalesce((select sum(km) from _gbb where started_at >= v_week_start), 0),
             'steps',    coalesce((select sum(steps) from _gbb where started_at >= v_week_start), 0)
           ),
           'last_week', jsonb_build_object(
             'sessions', (select count(*) from _gbb where started_at >= v_prev_start and started_at < now() - interval '7 days'),
             'km',       coalesce((select sum(km) from _gbb where started_at >= v_prev_start and started_at < now() - interval '7 days'), 0),
             'minutes',  coalesce((select sum(minutes) from _gbb where started_at >= v_prev_start and started_at < now() - interval '7 days'), 0)
           ),
           'month', jsonb_build_object(
             'sessions', (select count(*) from _gbb),
             'members',  (select count(distinct user_id) from _gbb),
             'minutes',  coalesce((select sum(minutes) from _gbb), 0),
             'km',       coalesce((select sum(km) from _gbb), 0),
             'steps',    coalesce((select sum(steps) from _gbb), 0)
           )
         )
    into v_totals;

  -- longest efforts this week: run, ride, swim (measured distance only)
  select jsonb_build_object(
           'running',  (select jsonb_build_object('user_id', b.user_id, 'km', b.km, 'minutes', b.minutes, 'started_at', b.started_at)
                        from _gbb b where b.s_type = 'running' and b.km_measured and b.started_at >= v_week_start
                        order by b.km desc limit 1),
           'cycling',  (select jsonb_build_object('user_id', b.user_id, 'km', b.km, 'minutes', b.minutes, 'started_at', b.started_at)
                        from _gbb b where b.s_type = 'cycling' and b.km_measured and b.started_at >= v_week_start
                        order by b.km desc limit 1),
           'swimming', (select jsonb_build_object('user_id', b.user_id, 'km', b.km, 'minutes', b.minutes, 'started_at', b.started_at)
                        from _gbb b where b.s_type = 'swimming' and b.km_measured and b.started_at >= v_week_start
                        order by b.km desc limit 1),
           'walking',  (select jsonb_build_object('user_id', b.user_id, 'steps', b.steps, 'started_at', b.started_at)
                        from _gbb b where b.s_type = 'walking' and b.steps > 0 and b.started_at >= v_week_start
                        order by b.steps desc limit 1)
         )
    into v_longest;

  drop table if exists _gbb;
  drop table if exists _gbm;

  return jsonb_build_object(
    'tz',      v_tz,
    'members', v_members,
    'week',    coalesce(v_week, '[]'::jsonb),
    'month',   coalesce(v_month, '[]'::jsonb),
    'days',    coalesce(v_days, '[]'::jsonb),
    'totals',  v_totals,
    'longest', v_longest
  );
end;
$$;

revoke all on function public._gym_board_beyond(uuid) from public, anon, authenticated;
grant execute on function public._gym_board_beyond(uuid) to service_role;
