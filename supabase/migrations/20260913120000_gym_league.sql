-- =============================================================
-- GYM LEAGUE — gyms racing each other on a big screen
--
-- Jamie (09-13): "a screen that shows gyms competing against one another,
-- locally to gyms that are close to each other as well as globally".
--
-- Lives beside the per-gym wall: one gym_boards row per partner already
-- carries the slug + display token, so the league is a second link on the
-- same credential (powr.life/league/<slug>?k=<token>) from the host gym's
-- point of view. Two settings here, everything else is derived:
--   league_enabled    pause the league screen without touching the wall
--   league_radius_km  the "local" lens — gyms within this many km of the host
--
-- _gym_league(partner) returns everything the screen needs in one call:
-- every gym ON POWR — an active gym partner with a location where someone
-- has earned points in the last 28 days (the catalogue holds ~7,900 gyms;
-- a gym nobody trains at is not in the race) — and its week so far (points,
-- points today, sessions, athletes, points by day, members in now) plus
-- the last 24 h of scoring sessions across the network for the live feed.
-- Scoring is the wall's rule: earn / adjustment / penalty rows on sessions
-- with activity_sessions.partner_id = the gym, session started inside the
-- week (Monday 00:00 in the board's tz), show_on_leaderboard members only.
-- Service-role only; the edge function hashes ids before anything leaves.
-- =============================================================

alter table public.gym_boards
  add column if not exists league_enabled boolean not null default true,
  add column if not exists league_radius_km integer not null default 15
    check (league_radius_km between 3 and 200);

comment on column public.gym_boards.league_enabled is
  'Whether the gym-vs-gym league screen (/league/<slug>) answers for this board. Independent of enabled (the wall).';
comment on column public.gym_boards.league_radius_km is
  'Radius of the league''s local lens: gyms within this many km of the host count as neighbours.';

create or replace function public._gym_league(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tz         text;
  v_radius     integer;
  v_local_now  timestamp;
  v_week_start timestamptz;
  v_week_end   timestamptz;
  v_day_start  timestamptz;
  v_gyms       jsonb;
  v_feed       jsonb;
begin
  select tz, league_radius_km into v_tz, v_radius
  from public.gym_boards where partner_id = p_partner_id;
  if not found then
    return null;
  end if;

  v_local_now  := now() at time zone v_tz;
  v_week_start := date_trunc('week', v_local_now) at time zone v_tz;
  v_week_end   := (date_trunc('week', v_local_now) + interval '7 days') at time zone v_tz;
  v_day_start  := date_trunc('day', v_local_now) at time zone v_tz;

  -- Every gym's week so far.
  with active_gyms as (
    select distinct s.partner_id
    from public.activity_sessions s
    join public.point_transactions pt
      on pt.session_id = s.id and pt.type in ('earn', 'adjustment', 'penalty')
    where s.partner_id is not null
      and s.started_at > now() - interval '28 days'
  ),
  sess as (
    select s.id, s.user_id, s.partner_id, s.started_at,
           ((s.started_at at time zone v_tz)::date - (v_week_start at time zone v_tz)::date) as dow,
           sum(pt.amount)::integer as points
    from public.activity_sessions s
    join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
    join public.point_transactions pt
      on pt.session_id = s.id and pt.type in ('earn', 'adjustment', 'penalty')
    where s.partner_id is not null
      and s.started_at >= v_week_start
      and s.started_at <  v_week_end
    group by s.id, s.user_id, s.partner_id, s.started_at
  ),
  per as (
    select partner_id,
           sum(points)::integer                                             as points_week,
           coalesce(sum(points) filter (where started_at >= v_day_start), 0)::integer as points_today,
           count(*)::integer                                                as sessions_week,
           count(distinct user_id)::integer                                 as athletes_week,
           array[
             coalesce(sum(points) filter (where dow = 0), 0)::integer,
             coalesce(sum(points) filter (where dow = 1), 0)::integer,
             coalesce(sum(points) filter (where dow = 2), 0)::integer,
             coalesce(sum(points) filter (where dow = 3), 0)::integer,
             coalesce(sum(points) filter (where dow = 4), 0)::integer,
             coalesce(sum(points) filter (where dow = 5), 0)::integer,
             coalesce(sum(points) filter (where dow = 6), 0)::integer
           ] as days
    from sess
    group by partner_id
  ),
  now_in as (
    select partner_id, count(*)::integer as in_now
    from public.gym_visits
    where ended_at is null
      and started_at > now() - interval '6 hours'
    group by partner_id
  )
  select jsonb_agg(jsonb_build_object(
           'id',            p.id,
           'name',          p.name,
           'address',       p.address,
           'lat',           l.lat,
           'lng',           l.lng,
           'points_week',   coalesce(x.points_week, 0),
           'points_today',  coalesce(x.points_today, 0),
           'sessions_week', coalesce(x.sessions_week, 0),
           'athletes_week', coalesce(x.athletes_week, 0),
           'days',          coalesce(to_jsonb(x.days), '[0,0,0,0,0,0,0]'::jsonb),
           'in_now',        coalesce(n.in_now, 0)
         ) order by coalesce(x.points_week, 0) desc, p.name)
  into v_gyms
  from public.partners p
  join public.partner_locations l on l.partner_id = p.id and l.loc_idx = 0
  left join per x on x.partner_id = p.id
  left join now_in n on n.partner_id = p.id
  where p.active = true
    and p.category = 'gym'
    and (p.id = p_partner_id or p.id in (select partner_id from active_gyms));

  -- The last day of scoring sessions across the network, newest first.
  select jsonb_agg(jsonb_build_object(
           'session_id', f.id,
           'user_id',    f.user_id,
           'partner_id', f.partner_id,
           'type',       f.s_type,
           'started_at', f.started_at,
           'minutes',    f.minutes,
           'points',     f.points
         ) order by f.started_at desc)
  into v_feed
  from (
    select s.id, s.user_id, s.partner_id, s.type::text as s_type, s.started_at,
           (coalesce(s.duration_sec,
                     greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at))) / 60)::integer as minutes,
           sum(pt.amount)::integer as points
    from public.activity_sessions s
    join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
    join public.partners pp on pp.id = s.partner_id and pp.active = true and pp.category = 'gym'
    join public.point_transactions pt
      on pt.session_id = s.id and pt.type in ('earn', 'adjustment', 'penalty')
    where s.started_at > now() - interval '24 hours'
    group by s.id, s.user_id, s.partner_id, s.type, s.started_at, s.ended_at, s.duration_sec
    having sum(pt.amount) > 0
    order by s.started_at desc
    limit 40
  ) f;

  return jsonb_build_object(
    'tz',            v_tz,
    'radius_km',     v_radius,
    'host_id',       p_partner_id,
    'week_start_at', v_week_start,
    'week_end_at',   v_week_end,
    'day_start_at',  v_day_start,
    'gyms',          coalesce(v_gyms, '[]'::jsonb),
    'feed',          coalesce(v_feed, '[]'::jsonb)
  );
end;
$$;

comment on function public._gym_league(uuid) is
  'Gym-vs-gym league payload for the host gym''s big screen: every gym partner''s week so far plus the last 24 h of scoring sessions. Service-role only; the gym-league edge function hashes ids.';

revoke all on function public._gym_league(uuid) from public, anon, authenticated;
grant execute on function public._gym_league(uuid) to service_role;
