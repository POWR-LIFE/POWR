-- The Series board on a quiet day: a size that isn't a round number, and
-- pacers that move before three members have.
--
-- Applies AFTER 20261113120000_series_push_daytime.sql. Live prod also has
-- 20261028100000_series_crowd_base (series_rounds.crowd_base), which isn't in
-- the repo: section 1 adds the column the same way so a replay has it.
--
-- Elliot, 15 Nov (day 1 of Round 01, 12:00): "1500 looks really rounded … on
-- the back end we only have 1482", and the board "seems kinda empty. Needs to
-- feel active … get some points on the pacers going to show a little spark".
--
-- 1. The size. The board held exactly pacer_target people on day 1 and grew by
--    exactly pacer_growth at each midnight: 1,500, 1,510, 1,520 … Every one of
--    those reads as made up (Elliot's 1,482 is the pacers in /admin/series:
--    1,500 on the board less the 18 members who joined). Now
--    _series_board_size(round, at) opens 1–4% under pacer_target (a stable
--    amount per round), and each day's growth (40–160% of pacer_growth, also
--    stable per round and day) arrives through the day, 06:00 to 22:00 London,
--    not all at midnight. It only ever rises, so nobody sees the crowd shrink.
--    The board, the start line's crowd at the gun and (once 20261102150000 is
--    applied) the TV all read it, so they agree.
--
-- 2. The pacer cap. A pacer stayed under the real #3, so places 1–3 were always
--    real people. With 18 members and 2 of them moving by noon, the real #3 was
--    on 0, so all 1,482 pacers were on 0 too. Now (Jamie, 15 Nov: "#1 always
--    real") a pacer stays under the higher of
--      * the real #3, as before, and
--      * the real leader less one, but never above 20 (a gym visit).
--    The leader is always a real member. On a quiet start a pacer can hold #2
--    or #3 until the real #3 reaches 20 or the leader's score, whichever is
--    lower; from then on it's the old rule. Both terms only ever rise, so a
--    pacer's points never go backwards. Nothing about prizes changes: every
--    result is drawn from _series_points (members only), and a pacer still
--    never sends a "passed you" push or becomes anyone's rival.
--
-- Restated: _series_field (from 20261022120000) and get_series_invite_board
-- (live prod's version: 20261027120000 plus series_crowd_base's 'base'). Only
-- the parts above change.
--
-- Idempotent: safe to run twice.

-- ── 1. The column live prod already has ──────────────────────────────────────

alter table public.series_rounds add column if not exists crowd_base numeric not null default 0.4;

-- ── 2. How many are on the board at a moment ────────────────────────────────

create or replace function public._series_board_size(p_round uuid, p_at timestamptz default now())
returns int
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select sr.id, sr.pacer_target, sr.pacer_growth,
           (sr.starts_at at time zone 'Europe/London')::date as day1,
           greatest(1, (sr.ends_at at time zone 'Europe/London')::date
                       - (sr.starts_at at time zone 'Europe/London')::date) as ndays,
           p_at at time zone 'Europe/London' as lon
      from public.series_rounds sr
     where sr.id = p_round
  ),
  c as (
    -- The round day p_at falls on (1 before the gun, the last day after the end).
    select r.*, greatest(1, least(r.ndays, r.lon::date - r.day1 + 1)) as di from r
  ),
  f as (
    -- How much of that day's growth has arrived: none before 06:00, all by 22:00.
    select c.*,
           case when c.lon::date < c.day1 + c.di - 1 then 0.0
                when c.lon::date > c.day1 + c.di - 1 then 1.0
                else least(1.0, greatest(0.0, (extract(epoch from c.lon::time) / 60.0 - 360) / 960.0))
           end as frac
      from c
  )
  select case when f.pacer_target <= 0 then 0 else (
           f.pacer_target
           -- opens 1–4% under the size set in /admin/series, the same amount all round
           - floor(f.pacer_target * (0.01 + 0.03 * public._series_rand(f.id || ':size')))
           -- each day's growth, 40–160% of pacer_growth: the days gone, then today's so far
           + floor(coalesce((select sum(f.pacer_growth * (0.4 + 1.2 * public._series_rand(f.id || ':grow:' || d)))
                               from generate_series(1, f.di - 1) d), 0)
                   + f.pacer_growth * (0.4 + 1.2 * public._series_rand(f.id || ':grow:' || f.di)) * f.frac)
         )::int end
    from f;
$$;

revoke all on function public._series_board_size(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public._series_board_size(uuid, timestamptz) to service_role;

-- ── 3. Everyone on the board ─────────────────────────────────────────────────
-- As 20261022120000, with the seats from _series_board_size and the cap above.
-- Callers still rank with `order by points desc, pacer, user_id` so a tie goes
-- to the member.

create or replace function public._series_field(p_round uuid)
returns table (
  user_id    uuid,
  pacer      boolean,
  listed     boolean,
  points     int,
  points_mid int,
  today      int,
  days       int[]
)
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select (sr.starts_at at time zone 'Europe/London')::date as day1
      from public.series_rounds sr where sr.id = p_round
  ),
  clock as (
    select (now() at time zone 'Europe/London')::date as d,
           (extract(hour from now() at time zone 'Europe/London') * 60
            + extract(minute from now() at time zone 'Europe/London'))::int as mins
  ),
  people as materialized (
    select * from public._series_points(p_round)
  ),
  -- The real leader and the real #3, now and at midnight.
  top as (
    select coalesce((select x.points from people x where x.listed order by x.points desc limit 1), 0) as p1,
           coalesce((select x.points from people x where x.listed order by x.points desc offset 2 limit 1), 0) as p3,
           coalesce((select x.points_mid from people x where x.listed order by x.points_mid desc limit 1), 0) as m1,
           coalesce((select x.points_mid from people x where x.listed order by x.points_mid desc offset 2 limit 1), 0) as m3
  ),
  -- What a pacer stays under: the real #3, or on a quiet start the real leader
  -- less one up to 20 (see the header). Never above the real leader.
  ref as (
    select greatest(top.p3, least(20, top.p1 - 1)) as pts,
           greatest(top.m3, least(20, top.m1 - 1)) as mid
      from top
  ),
  seats as (
    select greatest(0, public._series_board_size(p_round, now())
                       - (select count(*) from people x where x.listed))::int as k
  ),
  -- Seats go to the fastest pacers still on (the slowest retire first).
  seated as (
    select x.id, x.cap
      from (select pc.id, pc.cap, row_number() over (order by pc.retire_order desc) as n
              from public.series_pacers pc
             where not pc.disabled
               -- Never alongside a member of the same name.
               and not exists (select 1 from public.profiles p where lower(trim(p.display_name)) = lower(pc.name))) x, seats
     where x.n <= seats.k
  ),
  run as (
    select s.id, s.cap,
           coalesce(sum(pd.pts) filter (where r.day1 + pd.day - 1 < clock.d
                                           or (r.day1 + pd.day - 1 = clock.d and pd.at_min <= clock.mins)), 0)::int as pts,
           coalesce(sum(pd.pts) filter (where r.day1 + pd.day - 1 < clock.d), 0)::int as mid
      from seated s
      cross join r
      cross join clock
      left join public.series_pacer_days pd on pd.round_id = p_round and pd.pacer_id = s.id
     group by s.id, s.cap
  ),
  capped as (
    select run.id,
           least(run.pts, greatest(0, least(floor(ref.pts * run.cap)::int, ref.pts - 1))) as pts,
           least(run.mid, greatest(0, least(floor(ref.mid * run.cap)::int, ref.mid - 1))) as mid
      from run, ref
  )
  select x.user_id, false, x.listed, x.points, x.points_mid, x.today, x.days from people x
  union all
  select c.id, true, true, c.pts, c.mid, greatest(0, c.pts - c.mid), '{}'::int[] from capped c;
$$;

revoke all on function public._series_field(uuid) from public, anon, authenticated;
grant execute on function public._series_field(uuid) to service_role;

-- ── 4. The start line: the crowd at the gun is the board's opening size ─────

create or replace function public.get_series_invite_board(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_round public.series_rounds;
  v_out   jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_slug is not null then
    select * into v_round from public.series_rounds where slug = p_slug and (published or public.is_admin());
  else
    select * into v_round from public.series_rounds
     where published and starts_at > now() order by starts_at limit 1;
  end if;
  if v_round.id is null then
    return null;
  end if;

  with win as (
    select * from public._series_referral_windows(v_round.id)
  ),
  refs as (
    select rf.referrer_id, rf.referred_id, rf.converted_at
      from public.referrals rf
     where exists (select 1 from win w where rf.created_at >= w.starts_at and rf.created_at < w.ends_at)
       and not public._series_is_demo(rf.referred_id)
  ),
  per as (
    select r.referrer_id as user_id,
           count(distinct r.referred_id) filter (where r.converted_at is not null and r.converted_at < v_round.ends_at)::int as friends,
           count(distinct r.referred_id) filter (where r.converted_at is null)::int as joining,
           max(r.converted_at) as reached
      from refs r
     group by r.referrer_id
  ),
  -- Members who joined the round's season (20261027120000).
  members as (
    select p.id, coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') as name,
           coalesce(p.show_on_leaderboard, true) as listed
      from public.series_entries e
      join public.profiles p on p.id = e.user_id
     where e.season_id = v_round.season_id and e.joined_at < v_round.ends_at
       and not public._series_is_demo(p.id)
       and not exists (select 1 from public.series_exclusions x
                        where x.user_id = p.id and (x.round_id is null or x.round_id = v_round.id))
  ),
  ranked as (
    select m.id as user_id, m.name, m.listed, per.friends, per.joining,
           row_number() over (order by per.friends desc, per.reached, m.id)::int as rank
      from per join members m on m.id = per.user_id
     where per.friends > 0
  )
  select jsonb_build_object(
    'round', jsonb_build_object('slug', v_round.slug, 'name', v_round.name, 'starts_at', v_round.starts_at),
    'open', v_round.invite_from is not null and now() >= v_round.invite_from and now() < v_round.starts_at,
    'opens_at', v_round.invite_from,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'rank', k.rank, 'name', k.name, 'friends', k.friends, 'joining', k.joining, 'you', k.user_id = v_uid)
              order by k.rank)
              from ranked k where (k.rank <= 10 and k.listed) or k.user_id = v_uid), '[]'::jsonb),
    'ranked', (select count(*) from ranked),
    'start_line', (select count(*) from members m where m.listed and not exists (select 1 from ranked k where k.user_id = m.id)),
    -- The crowd at the start line: real members waiting, and the pacers who
    -- fill it up to the board's opening size by the gun (_series_board_size at
    -- the start, so the start line and the board agree at 00:00).
    'crowd', jsonb_build_object(
      'real', (select count(*) from members m where m.listed),
      'pacers_at_gun', least(
        (select count(*) from public.series_pacers sp where not sp.disabled),
        greatest(0, public._series_board_size(v_round.id, v_round.starts_at) - (select count(*) from members))),
      'ramp_from', coalesce(v_round.invite_from, v_round.starts_at - interval '14 days'),
      'ramp_to', v_round.starts_at,
      'base', v_round.crowd_base),
    'me', jsonb_build_object(
      'rank', (select k.rank from ranked k where k.user_id = v_uid),
      'friends', coalesce((select p.friends from per p where p.user_id = v_uid), 0),
      'joining', coalesce((select p.joining from per p where p.user_id = v_uid), 0),
      'code', (select pr.referral_code from public.profiles pr where pr.id = v_uid),
      'joined', exists (select 1 from public.series_entries e
                         where e.season_id = v_round.season_id and e.user_id = v_uid))
  ) into v_out;
  return v_out;
end;
$$;

-- ── 5. Admin: the seats and the safety margin under the new rules ───────────
-- As 20261022150000, plus `size` (the board now), `real_first` and
-- `pacer_ceiling` (the most a pacer may show right now). The guarantee
-- /admin/series checks is now the highest pacer under the real leader.

create or replace function public.admin_series_pacers(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_round public.series_rounds;
  v_day   int;
  v_size  int;
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_round from public.series_rounds where slug = p_slug;
  if v_round.id is null then
    return null;
  end if;
  v_day := greatest(1, least(
    (v_round.ends_at at time zone 'Europe/London')::date - (v_round.starts_at at time zone 'Europe/London')::date,
    (now() at time zone 'Europe/London')::date - (v_round.starts_at at time zone 'Europe/London')::date + 1));
  v_size := public._series_board_size(v_round.id, now());

  with f as materialized (
    select * from public._series_field(v_round.id) where listed
  ),
  top as (
    select coalesce((select points from f where not pacer order by points desc limit 1), 0) as p1,
           coalesce((select points from f where not pacer order by points desc offset 2 limit 1), 0) as p3
  )
  select jsonb_build_object(
    'target', v_round.pacer_target,
    'growth', v_round.pacer_growth,
    'day', v_day,
    'size', v_size,
    'seats', greatest(0, v_size - (select count(*) from f where not pacer)),
    'members', (select count(*) from f where not pacer),
    'seated', (select count(*) from f where pacer),
    'pool', (select count(*) from public.series_pacers),
    'disabled', (select count(*) from public.series_pacers where disabled),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (
                 select pc.kind, count(*) as n from f join public.series_pacers pc on pc.id = f.user_id where f.pacer group by pc.kind) k),
                 '{}'::jsonb),
    'top_pacer', (select max(points) from f where pacer),
    'real_first', (select points from f where not pacer order by points desc limit 1),
    'real_third', (select points from f where not pacer order by points desc offset 2 limit 1),
    'pacer_ceiling', (select greatest(0, greatest(top.p3, least(20, top.p1 - 1)) - 1) from top),
    'planned_days', (select count(*) from public.series_pacer_days where round_id = v_round.id)
  ) into v_out;
  return v_out;
end;
$$;
