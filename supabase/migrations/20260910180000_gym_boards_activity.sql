-- =============================================================
-- GYM BOARDS — the activity feed
--
-- Jamie (09-10): "scroll through users' activities also so we can see what
-- they have earned on … a boring static page won't sell". The wall now
-- carries the recent sessions members earned points on at this gym: who,
-- what (activity type), how long, when, and the points it paid.
--
-- Separate RPC rather than another gym_board_payload rewrite: the feed is
-- its own shape, the edge fn calls both. Service-role only, like the rest.
-- Last 7 days (not "this week") so a Monday morning wall isn't empty.
-- Only sessions that actually paid (counted rows > 0); a superseded or
-- rejected session never scrolls past as if it counted.
-- =============================================================

create or replace function public._gym_board_activity(
  p_partner_id uuid,
  p_since      timestamptz default now() - interval '7 days',
  p_limit      integer     default 24
)
returns table (
  session_id   uuid,
  user_id      uuid,
  s_type       text,
  started_at   timestamptz,
  ended_at     timestamptz,
  minutes      integer,
  points       integer,
  verification text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id                                   as session_id,
    s.user_id,
    s.type::text                           as s_type,
    s.started_at,
    coalesce(s.ended_at, s.started_at)     as ended_at,
    (coalesce(s.duration_sec,
              greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at)))
       / 60)::integer                      as minutes,
    sum(pt.amount)::integer                as points,
    s.verification::text                   as verification
  from public.activity_sessions s
  join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
  join public.point_transactions pt
    on pt.session_id = s.id
   and pt.type in ('earn', 'adjustment', 'penalty')
  where s.partner_id = p_partner_id
    and coalesce(s.ended_at, s.started_at) >= p_since
  group by s.id, s.user_id, s.type, s.started_at, s.ended_at, s.duration_sec, s.verification
  having sum(pt.amount) > 0
  order by coalesce(s.ended_at, s.started_at) desc
  limit greatest(1, least(p_limit, 100))
$$;

revoke all on function public._gym_board_activity(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public._gym_board_activity(uuid, timestamptz, integer) to service_role;
