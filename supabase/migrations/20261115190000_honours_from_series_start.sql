-- Trophies count from the Series start, not from the start of time.
--
-- Applies AFTER 20261027180000_honours.sql. Live prod also has
-- 20261028120000_honours_hive_null_referrer, which isn't in the repo: it
-- added `rf.referrer_id is not null` to the Hive. award_honours below is
-- live prod's version (checked 15 Nov) with only the changes listed here.
--
-- Jamie, 15 Nov: "count only from the series start". award_honours counted
-- every session since 2000-01-01, so on the first nightly run (28 Oct) the
-- members who'd used POWR since spring were handed Strength, On Fire and
-- Power from history, and the board showed them on day 1 of Round 01.
--
-- 1. _honour_from(): when the Series started, the first published round's
--    start (Round 01, 15 Nov 2026 00:00 London). No published round: nothing
--    counts yet.
-- 2. award_honours: active days, Strength sessions and Hive friends count
--    from _honour_from(). A Hive friend counts once they convert on or after
--    it. Wings, Diamond and the King were already per round: unchanged.
-- 3. Reset. Every Strength, On Fire, Power and Hive trophy held now came
--    from before the Series, so they go, with their award log, and
--    award_honours rebuilds from the Series start. A copy of what's removed
--    is kept in honours_reset_20261115 / honour_awards_reset_20261115
--    (no access but the service role). No bonus points were ever paid for
--    them (system_config honours_bonus is 'off'), so nothing to claw back.
--
-- Idempotent: safe to run twice (the copies are taken once; the rebuild
-- gives the same trophies).

-- ── 1. The start ─────────────────────────────────────────────────────────────

create or replace function public._honour_from()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(min(starts_at), 'infinity'::timestamptz) from public.series_rounds where published
$$;
revoke all on function public._honour_from() from public, anon, authenticated;

-- ── 2. The daily check, from the Series start ────────────────────────────────

create or replace function public.award_honours()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
  v_pay   boolean := coalesce((select value from public.system_config where key = 'honours_bonus'), 'off') = 'on';
  r record;
  v_king uuid;
  -- Trophies count from the Series start, not before (20261115190000).
  v_from  timestamptz := public._honour_from();
begin
  -- Active days since the Series started (one row per member per London day).
  create temp table t_days on commit drop as
    select user_id, day from public._honour_sessions(v_from, now()) group by user_id, day;

  -- ── Power and On Fire: closed weeks, Monday to Sunday ──────────────────────
  create temp table t_weeks on commit drop as
    select user_id, date_trunc('week', day)::date as wk, count(*)::int as days
      from t_days
     where date_trunc('week', day)::date < date_trunc('week', v_today)::date
     group by user_id, date_trunc('week', day);
  for r in
    select user_id,
           count(*)::int as w1,
           count(*) filter (where days >= 4)::int as w4,
           count(*) filter (where days >= 5)::int as w5,
           count(*) filter (where days >= 6)::int as w6
      from t_weeks group by user_id
  loop
    perform public._honour_set(r.user_id, 'on_fire', r.w1);
    perform public._honour_set(r.user_id, 'power', r.w4, jsonb_build_object('w5', r.w5, 'w6', r.w6));
  end loop;

  -- ── Strength: gym sessions of 20+ minutes since the Series started ─────────
  for r in
    select user_id, count(*)::int as n from public._honour_sessions(v_from, now())
     where type = 'gym' and duration_sec >= 1200 group by user_id
  loop
    perform public._honour_set(r.user_id, 'strength', r.n);
  end loop;

  -- ── The Hive: friends who joined with your code and worked out ─────────────
  -- Only friends who converted since the Series started. Active: 4+ active
  -- days (counted from the Series start) in their first 30 days on POWR.
  for r in
    select rf.referrer_id as user_id,
           count(*)::int as friends,
           count(*) filter (where (
             select count(*) from t_days d
              where d.user_id = rf.referred_id
                and d.day < (p.created_at at time zone 'Europe/London')::date + 30) >= 4)::int as active
      from public.referrals rf
      join public.profiles p on p.id = rf.referred_id
     where rf.converted_at is not null
       and rf.converted_at >= v_from
       and rf.referrer_id is not null
     group by rf.referrer_id
  loop
    perform public._honour_set(r.user_id, 'hive', r.friends, jsonb_build_object('active', r.active));
  end loop;

  -- ── Wings: where everyone stood after day 1, and the best place since ──────
  for r in
    select id, starts_at, ends_at from public.series_rounds
     where published and starts_at + interval '1 day' <= now() and ends_at + interval '1 day' > now()
  loop
    -- Day 1 closed: record the field as it stands (once).
    -- Members only (_series_points: the settle's own view; pacers never appear).
    insert into public.honour_round_ranks (round_id, user_id, day1_rank, best_rank)
    select r.id, s.user_id, s.rank, s.rank
      from (select p.user_id, row_number() over (order by p.points desc, p.user_id)::int as rank
              from public._series_points(r.id) p where p.listed) s
     where not exists (select 1 from public.honour_round_ranks x where x.round_id = r.id)
       and now() < r.starts_at + interval '2 days';
    -- Every day after: the best place reached, and the final one once it's over.
    update public.honour_round_ranks x
       set best_rank = least(x.best_rank, s.rank),
           final_rank = case when r.ends_at <= now() then s.rank else x.final_rank end
      from (select p.user_id, row_number() over (order by p.points desc, p.user_id)::int as rank
              from public._series_points(r.id) p where p.listed) s
     where x.round_id = r.id and x.user_id = s.user_id;
  end loop;
  for r in
    select user_id,
           max(day1_rank - final_rank)::int as climb,
           bool_or(best_rank = 1 and day1_rank > 10) as top
      from public.honour_round_ranks where final_rank is not null
     group by user_id
  loop
    perform public._honour_set(r.user_id, 'wings', greatest(0, r.climb), jsonb_build_object('top', r.top));
  end loop;

  -- ── Diamond: rounds that have ended, active on every day ───────────────────
  for r in
    select d.user_id, count(*)::int as n
      from (select rd.id, (rd.starts_at at time zone 'Europe/London')::date as d1,
                   ((rd.ends_at at time zone 'Europe/London')::date - (rd.starts_at at time zone 'Europe/London')::date)::int as days
              from public.series_rounds rd where rd.published and rd.ends_at <= now()) rd
      join lateral (
        select t.user_id from t_days t
         where t.day >= rd.d1 and t.day < rd.d1 + rd.days
         group by t.user_id having count(*) >= rd.days) d on true
     group by d.user_id
  loop
    perform public._honour_set(r.user_id, 'diamond', r.n);
  end loop;

  -- ── King: the latest round winner wears it until the next is decided ───────
  select res.user_id into v_king
    from public.series_results res
    join public.series_rounds rd on rd.id = res.round_id
   where res.kind = 'place' and res.place = 1 and res.status <> 'void' and rd.ends_at <= now()
   order by rd.ends_at desc limit 1;
  if v_king is not null then
    delete from public.honours where kind = 'king' and user_id <> v_king;
    perform public._honour_set(v_king, 'king',
      (select count(*)::int from public.series_results res
        where res.kind = 'place' and res.place = 1 and res.status <> 'void' and res.user_id = v_king));
    -- A win pays once, on the day it lands.
    if v_pay then
      insert into public.point_transactions (user_id, amount, type, description)
      select v_king, public._honour_bonus('king', 'gold'), 'bonus', 'Trophy: King'
       where exists (select 1 from public.honour_awards a where a.user_id = v_king and a.kind = 'king' and a.awarded_at >= now() - interval '1 second');
    end if;
  end if;

  drop table if exists t_weeks;
  drop table if exists t_days;
end;
$$;
revoke all on function public.award_honours() from public, anon, authenticated;

-- ── 3. Reset: drop what came from before the Series, then rebuild ────────────

create table if not exists public.honours_reset_20261115 as
  select * from public.honours where kind in ('strength', 'on_fire', 'power', 'hive');
create table if not exists public.honour_awards_reset_20261115 as
  select * from public.honour_awards where kind in ('strength', 'on_fire', 'power', 'hive');
alter table public.honours_reset_20261115 enable row level security;
alter table public.honour_awards_reset_20261115 enable row level security;
revoke all on table public.honours_reset_20261115 from anon, authenticated;
revoke all on table public.honour_awards_reset_20261115 from anon, authenticated;

delete from public.honour_awards where kind in ('strength', 'on_fire', 'power', 'hive');
delete from public.honours where kind in ('strength', 'on_fire', 'power', 'hive');

select public.award_honours();
