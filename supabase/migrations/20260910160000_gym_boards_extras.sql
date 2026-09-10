-- =============================================================
-- GYM BOARDS — more of the member on the wall
--
-- Jamie (09-10): "is there any other information we can put on there from
-- the user" → the cheap-and-safe set. Per row: minutes trained here this
-- week, points today, lifetime points (→ level, resolved in the edge fn
-- from _shared/levels.ts), streak, first-week-here flag, personal-best flag,
-- last week's score (→ most improved). Per gym: a spotlight — session of
-- the week, most improved, new this week. Champion card: member since.
--
-- Nothing health-shaped (HR, zones) leaves the server: a wall is not the app.
-- =============================================================

-- ── Streak, the same rule as _shared/streak.ts, in SQL ─────────────────────
-- Consecutive distinct LOCAL activity days (profile tz, London fallback)
-- ending today or yesterday; verification <> 'manual'; a completed streak
-- rescue's missed_day counts as an active day. 90-day lookback.

create or replace function public._gym_board_streak(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with tz as (
    select coalesce(nullif(p.timezone, ''), 'Europe/London') as tz
    from public.profiles p where p.id = p_user_id
  ),
  days as (
    select distinct (s.started_at at time zone (select tz from tz))::date as d
    from public.activity_sessions s
    where s.user_id = p_user_id
      and s.verification <> 'manual'
      and s.started_at >= now() - interval '90 days'
    union
    select r.missed_day
    from public.streak_rescues r
    where r.user_id = p_user_id
      and r.status = 'completed'
      and r.missed_day >= (now() - interval '90 days')::date
  ),
  ordered as (
    select d, row_number() over (order by d desc) as rn from days
  ),
  head as (
    select d as d0 from ordered where rn = 1
  ),
  today as (
    select (now() at time zone (select tz from tz))::date as t
  )
  select case
    when not exists (select 1 from head, today where head.d0 in (today.t, today.t - 1)) then 0
    -- a gap at row k makes d0 - d exceed rn - 1 for every row after it
    else (select count(*)::integer from ordered o, head where head.d0 - o.d = o.rn - 1)
  end
$$;

revoke all on function public._gym_board_streak(uuid) from public, anon, authenticated;
grant execute on function public._gym_board_streak(uuid) to service_role;

-- ── Payload v2 ─────────────────────────────────────────────────────────────

create or replace function public.gym_board_payload(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz         text;
  v_size       integer;
  v_local_now  timestamp;
  v_week_start timestamptz;
  v_week_end   timestamptz;
  v_prev_start timestamptz;
  v_day_start  timestamptz;
  v_standings  jsonb;
  v_stats      jsonb;
  v_last_week  jsonb;
  v_spotlight  jsonb;
  v_members    integer;
begin
  select tz, board_size into v_tz, v_size from public.gym_boards where partner_id = p_partner_id;
  if not found then
    return null;
  end if;

  v_local_now  := now() at time zone v_tz;
  v_week_start := date_trunc('week', v_local_now) at time zone v_tz;
  v_week_end   := (date_trunc('week', v_local_now) + interval '7 days') at time zone v_tz;
  v_prev_start := (date_trunc('week', v_local_now) - interval '7 days') at time zone v_tz;
  v_day_start  := date_trunc('day', v_local_now) at time zone v_tz;

  with sess as (
    select s.id, s.user_id, s.type::text as s_type, s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at,
           coalesce(s.duration_sec, greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at)))::integer as duration_sec
    from public.activity_sessions s
    where s.partner_id = p_partner_id
      and coalesce(s.ended_at, s.started_at) > v_week_start
      and s.started_at < v_week_end
  ),
  now_rows as (
    select * from public._gym_board_scores(p_partner_id, v_week_start, v_week_end, v_tz)
    where score > 0
  ),
  then_rows as (
    select user_id, rank as prev_rank
    from public._gym_board_scores(p_partner_id, v_week_start, v_day_start, v_tz)
    where v_day_start > v_week_start and score > 0
  ),
  last_rows as (
    select user_id, score as last_score
    from public._gym_board_scores(p_partner_id, v_prev_start, v_week_start, v_tz)
  ),
  minutes as (
    select user_id, (sum(duration_sec) / 60)::integer as minutes
    from sess group by user_id
  ),
  today as (
    select pt.user_id, sum(pt.amount)::integer as today_points
    from public.point_transactions pt
    join sess s on s.id = pt.session_id
    where pt.type in ('earn', 'adjustment', 'penalty')
      and pt.created_at >= v_day_start
    group by pt.user_id
  ),
  first_here as (
    select s.user_id, min(s.started_at) as first_at
    from public.activity_sessions s
    where s.partner_id = p_partner_id
    group by s.user_id
  ),
  -- best previous week at this gym, on the same week grid
  best_prev as (
    select w.user_id, max(w.wk_score) as best
    from (
      select pt.user_id,
             date_trunc('week', s.started_at at time zone v_tz) as wk,
             sum(pt.amount) as wk_score
      from public.point_transactions pt
      join public.activity_sessions s on s.id = pt.session_id
      where s.partner_id = p_partner_id
        and pt.type in ('earn', 'adjustment', 'penalty')
        and s.started_at < v_week_start
      group by pt.user_id, date_trunc('week', s.started_at at time zone v_tz)
    ) w
    group by w.user_id
  ),
  lifetime as (
    select n.user_id,
      (
        coalesce((select sum(pt.amount) from public.point_transactions pt
                   where pt.user_id = n.user_id and pt.amount > 0), 0)
        + coalesce((select sum(vd.amount) from public.vault_deposits vd
                     where vd.user_id = n.user_id and vd.released_at is null), 0)
      )::integer as total_earned
    from now_rows n
  ),
  ranked as (
    select n.user_id, n.score, n.sessions, n.active_days, n.rank, t.prev_rank,
           coalesce(m.minutes, 0)        as minutes,
           coalesce(td.today_points, 0)  as today_points,
           lt.total_earned,
           public._gym_board_streak(n.user_id) as streak,
           (fh.first_at >= v_week_start)  as is_new,
           -- a PB needs a previous week to beat; a first week here is 'new', not 'PB'
           (bp.best is not null and n.score > bp.best) as is_pb,
           coalesce(l.last_score, 0)     as last_week_points
    from now_rows n
    left join then_rows t  on t.user_id  = n.user_id
    left join last_rows l  on l.user_id  = n.user_id
    left join minutes m    on m.user_id  = n.user_id
    left join today td     on td.user_id = n.user_id
    left join first_here fh on fh.user_id = n.user_id
    left join best_prev bp on bp.user_id = n.user_id
    left join lifetime lt  on lt.user_id = n.user_id
    order by n.rank
    limit v_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',          r.user_id,
           'score',            r.score,
           'sessions',         r.sessions,
           'active_days',      r.active_days,
           'rank',             r.rank,
           'prev_rank',        r.prev_rank,
           'minutes',          r.minutes,
           'today_points',     r.today_points,
           'total_earned',     r.total_earned,
           'streak',           r.streak,
           'is_new',           r.is_new,
           'is_pb',            r.is_pb,
           'last_week_points', r.last_week_points
         ) order by r.rank), '[]'::jsonb)
    into v_standings
  from ranked r;

  select jsonb_build_object(
           'members',  count(*),
           'points',   coalesce(sum(greatest(score, 0)), 0),
           'sessions', coalesce(sum(sessions), 0),
           'minutes',  coalesce((select sum(coalesce(x.duration_sec, greatest(0, extract(epoch from coalesce(x.ended_at, x.started_at) - x.started_at)))) / 60
                                 from public.activity_sessions x
                                 where x.partner_id = p_partner_id
                                   and coalesce(x.ended_at, x.started_at) > v_week_start
                                   and x.started_at < v_week_end), 0)::integer
         )
    into v_stats
  from public._gym_board_scores(p_partner_id, v_week_start, v_week_end, v_tz);

  -- Last week's podium, with member-since for the champion card.
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',      s.user_id,
           'score',        s.score,
           'sessions',     s.sessions,
           'rank',         s.rank,
           'member_since', p.created_at,
           'total_earned', (
             coalesce((select sum(pt.amount) from public.point_transactions pt
                        where pt.user_id = s.user_id and pt.amount > 0), 0)
             + coalesce((select sum(vd.amount) from public.vault_deposits vd
                          where vd.user_id = s.user_id and vd.released_at is null), 0)
           )::integer
         ) order by s.rank), '[]'::jsonb)
    into v_last_week
  from (
    select * from public._gym_board_scores(p_partner_id, v_prev_start, v_week_start, v_tz)
    where score > 0
    order by rank
    limit 3
  ) s
  join public.profiles p on p.id = s.user_id;

  -- Spotlight: the single biggest session this week, the biggest gain on
  -- last week, and who trained here for the first time this week.
  with sess as (
    select s.id, s.user_id, s.type::text as s_type, s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at,
           coalesce(s.duration_sec, greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at)))::integer as duration_sec
    from public.activity_sessions s
    where s.partner_id = p_partner_id
      and coalesce(s.ended_at, s.started_at) > v_week_start
      and s.started_at < v_week_end
  ),
  sess_pts as (
    select s.id, s.user_id, s.s_type, s.started_at, s.duration_sec, sum(pt.amount)::integer as points
    from sess s
    join public.point_transactions pt on pt.session_id = s.id
    join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
    where pt.type in ('earn', 'adjustment', 'penalty')
    group by s.id, s.user_id, s.s_type, s.started_at, s.duration_sec
  ),
  best_session as (
    select * from sess_pts where points > 0 order by points desc, started_at asc limit 1
  ),
  improved as (
    select n.user_id, n.score as this_week, coalesce(l.score, 0) as last_week,
           n.score - coalesce(l.score, 0) as gain
    from public._gym_board_scores(p_partner_id, v_week_start, v_week_end, v_tz) n
    left join public._gym_board_scores(p_partner_id, v_prev_start, v_week_start, v_tz) l
      on l.user_id = n.user_id
    where n.score > 0 and coalesce(l.score, 0) > 0 and n.score > coalesce(l.score, 0)
    order by (n.score - coalesce(l.score, 0)) desc, n.score desc
    limit 1
  ),
  newcomers as (
    select fh.user_id
    from (
      select s.user_id, min(s.started_at) as first_at
      from public.activity_sessions s
      where s.partner_id = p_partner_id
      group by s.user_id
    ) fh
    join public.profiles p on p.id = fh.user_id and p.show_on_leaderboard = true
    where fh.first_at >= v_week_start
    order by fh.first_at
    limit 6
  )
  select jsonb_build_object(
           'session', (select jsonb_build_object(
                         'user_id', b.user_id, 'points', b.points, 'type', b.s_type,
                         'started_at', b.started_at, 'minutes', (b.duration_sec / 60)::integer)
                       from best_session b),
           'improved', (select jsonb_build_object(
                          'user_id', i.user_id, 'this_week', i.this_week,
                          'last_week', i.last_week, 'gain', i.gain)
                        from improved i),
           'new_members', coalesce((select jsonb_agg(nc.user_id) from newcomers nc), '[]'::jsonb)
         )
    into v_spotlight;

  select count(distinct s.user_id) into v_members
  from public.activity_sessions s
  join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
  where s.partner_id = p_partner_id;

  return jsonb_build_object(
    'tz',             v_tz,
    'week_start_at',  v_week_start,
    'week_end_at',    v_week_end,
    'day_start_at',   v_day_start,
    'standings',      v_standings,
    'stats',          v_stats,
    'last_week',      jsonb_build_object(
                        'week_start_at', v_prev_start,
                        'week_end_at',   v_week_start,
                        'podium',        v_last_week
                      ),
    'spotlight',      v_spotlight,
    'community',      v_members
  );
end;
$$;

revoke all on function public.gym_board_payload(uuid) from public, anon, authenticated;
grant execute on function public.gym_board_payload(uuid) to service_role;
