-- ── Honours (the trophies) ────────────────────────────────────────────────────
-- Sorine's "Trophies: Brief for J" (27 Oct 2026). Seven trophies, each for one
-- thing, shown as small icons under a name on the Series board and kept for
-- good. Every trophy but the King has four metals; progress adds up and never
-- resets. Checked once a day just after London midnight; Wings, Diamond and
-- the King settle when a round ends.
--
--   king      the round winner, worn until the next winner    gold only, one holder
--   power     weeks with 4+ / 5+ / 6+ active days             4×5 / 4×10 / 5×25 / 6×30 weeks
--   on_fire   weeks with at least one active day              10 / 20 / 40 / 60
--   diamond   rounds active on every day                      1 / 3 / 6 / 12
--   wings     places climbed in a round, day 1 to the end     10 / 20 / 30 / Nº 1 from outside the top 10
--   hive      friends in: joined with your code + a session   3 friends / 6 / 12 / 30 ACTIVE friends
--   strength  strength sessions, all time                     4 / 30 / 60 / 100
--
-- Counting (the brief's definitions):
--   session         20+ minutes, from the app or a wearable; manual never counts; flagged
--                   never counts; demo accounts never count; synced within 48 h
--   active day      a London day with a session, or 8,000+ steps
--   strength        a gym session of 20+ minutes
--   week            Monday to Sunday, London; only closed weeks count
--   round           as set up in series_rounds (admin), not a fixed calendar
--   active friend   joined with your code, converted, and 4+ active days in their first 30 days
--
-- Bonus points per metal (500 / 2,000 / 7,500 / 15,000, King 5,000 a win) go to
-- the wallet as 'bonus', which the Series ignores. They are OFF until
-- system_config 'honours_bonus' = 'on': every award is logged either way, and
-- turning it on pays only awards from then on.

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.honours (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('king', 'on_fire', 'power', 'diamond', 'wings', 'hive', 'strength')),
  tier       text not null check (tier in ('bronze', 'silver', 'gold', 'platinum')),
  -- The main number behind it (weeks, rounds, places, friends, sessions, wins).
  count      int  not null default 0 check (count >= 0),
  -- The rest of the numbers the cabinet shows progress from (power: weeks4/5/6; hive: active; wings: top).
  detail     jsonb not null default '{}'::jsonb,
  earned_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.honours enable row level security;
drop policy if exists honours_read on public.honours;
create policy honours_read on public.honours for select to authenticated using (true);

-- Every metal ever reached, with what it paid. One row per (user, kind, tier).
create table if not exists public.honour_awards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  tier       text not null,
  points     int  not null default 0,
  awarded_at timestamptz not null default now(),
  unique (user_id, kind, tier, awarded_at)
);
alter table public.honour_awards enable row level security;
drop policy if exists honour_awards_own on public.honour_awards;
create policy honour_awards_own on public.honour_awards for select to authenticated using (user_id = auth.uid());

-- Wings needs where everyone stood at the end of a round's first day, and the
-- best place they reached in it. One row per member per round, kept by the
-- daily check (the Series' own snapshots only hold the latest position).
create table if not exists public.honour_round_ranks (
  round_id   uuid not null references public.series_rounds(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day1_rank  int  not null,
  best_rank  int  not null,
  final_rank int,
  primary key (round_id, user_id)
);
alter table public.honour_round_ranks enable row level security;

-- ── Thresholds ───────────────────────────────────────────────────────────────

create or replace function public._honour_rank(p_tier text)
returns int language sql immutable
as $$ select case p_tier when 'platinum' then 4 when 'gold' then 3 when 'silver' then 2 when 'bronze' then 1 else 0 end $$;

-- The metal a set of numbers earns. `d` carries the extra numbers per kind.
create or replace function public._honour_tier(p_kind text, p_count int, d jsonb default '{}'::jsonb)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'king' then case when p_count >= 1 then 'gold' end
    when 'power' then case
      when coalesce((d->>'w6')::int, 0) >= 30 then 'platinum'
      when coalesce((d->>'w5')::int, 0) >= 25 then 'gold'
      when p_count >= 10 then 'silver'
      when p_count >= 5 then 'bronze' end
    when 'on_fire'  then case when p_count >= 60 then 'platinum' when p_count >= 40 then 'gold' when p_count >= 20 then 'silver' when p_count >= 10 then 'bronze' end
    when 'diamond'  then case when p_count >= 12 then 'platinum' when p_count >= 6  then 'gold' when p_count >= 3  then 'silver' when p_count >= 1  then 'bronze' end
    when 'wings'    then case when coalesce((d->>'top')::boolean, false) then 'platinum' when p_count >= 30 then 'gold' when p_count >= 20 then 'silver' when p_count >= 10 then 'bronze' end
    when 'hive'     then case
      when coalesce((d->>'active')::int, 0) >= 30 then 'platinum'
      when coalesce((d->>'active')::int, 0) >= 12 then 'gold'
      when coalesce((d->>'active')::int, 0) >= 6  then 'silver'
      when p_count >= 3 then 'bronze' end
    when 'strength' then case when p_count >= 100 then 'platinum' when p_count >= 60 then 'gold' when p_count >= 30 then 'silver' when p_count >= 4 then 'bronze' end
  end
$$;

create or replace function public._honour_bonus(p_kind text, p_tier text)
returns int language sql immutable
as $$ select case when p_kind = 'king' then 5000 else case p_tier when 'bronze' then 500 when 'silver' then 2000 when 'gold' then 7500 when 'platinum' then 15000 else 0 end end $$;

-- ── Sessions that count for trophies ─────────────────────────────────────────

create or replace function public._honour_sessions(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, day date, type public.activity_type, duration_sec int, steps int, started_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id,
         (a.started_at at time zone 'Europe/London')::date,
         a.type, a.duration_sec, a.steps, a.started_at
    from public.activity_sessions a
   where a.started_at >= p_from
     and a.started_at < least(p_to, now())
     and a.verification <> 'manual'
     and not coalesce(a.flagged, false)
     and a.type <> 'sleep'
     and (a.duration_sec >= 1200 or coalesce(a.steps, 0) >= 8000)
     and a.created_at <= a.ended_at + interval '48 hours'
     and not public._series_is_demo(a.user_id)
$$;

-- ── Writing a result ─────────────────────────────────────────────────────────

-- The metal never drops; the numbers are the best seen. A new metal is logged
-- and, with the switch on, paid.
create or replace function public._honour_set(p_user uuid, p_kind text, p_count int, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text := public._honour_tier(p_kind, p_count, p_detail);
  v_old  public.honours;
  v_pay  boolean := coalesce((select value from public.system_config where key = 'honours_bonus'), 'off') = 'on';
  v_pts  int;
begin
  if v_tier is null then return; end if;
  select * into v_old from public.honours where user_id = p_user and kind = p_kind;
  if v_old.user_id is null then
    insert into public.honours (user_id, kind, tier, count, detail) values (p_user, p_kind, v_tier, p_count, p_detail);
  elsif public._honour_rank(v_tier) > public._honour_rank(v_old.tier)
     or p_count > v_old.count or p_detail <> v_old.detail then
    update public.honours
       set tier = case when public._honour_rank(v_tier) > public._honour_rank(v_old.tier) then v_tier else v_old.tier end,
           count = greatest(v_old.count, p_count),
           detail = v_old.detail || p_detail,
           earned_at = case when public._honour_rank(v_tier) > public._honour_rank(v_old.tier) then now() else v_old.earned_at end,
           updated_at = now()
     where user_id = p_user and kind = p_kind;
  end if;
  -- Every metal passed on the way up is an award; the King is an award a win.
  if v_old.user_id is null or public._honour_rank(v_tier) > public._honour_rank(v_old.tier) then
    for v_pts in
      select r from generate_series(coalesce(public._honour_rank(v_old.tier), 0) + 1, public._honour_rank(v_tier)) r
    loop
      insert into public.honour_awards (user_id, kind, tier, points)
      values (p_user, p_kind, case v_pts when 1 then 'bronze' when 2 then 'silver' when 3 then 'gold' else 'platinum' end,
              case when v_pay then public._honour_bonus(p_kind, case v_pts when 1 then 'bronze' when 2 then 'silver' when 3 then 'gold' else 'platinum' end) else 0 end)
      on conflict do nothing;
    end loop;
  end if;
  if p_kind <> 'king' and v_pay and (v_old.user_id is null or public._honour_rank(v_tier) > public._honour_rank(v_old.tier)) then
    insert into public.point_transactions (user_id, amount, type, description)
    select p_user, sum(a.points), 'bonus', 'Trophy: ' || p_kind || ' ' || v_tier
      from public.honour_awards a
     where a.user_id = p_user and a.kind = p_kind and a.awarded_at >= now() - interval '1 second' and a.points > 0
    having sum(a.points) > 0;
  end if;
end;
$$;

-- ── The daily check ──────────────────────────────────────────────────────────

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
begin
  -- Active days, all time (one row per member per London day).
  create temp table t_days on commit drop as
    select user_id, day from public._honour_sessions('2000-01-01', now()) group by user_id, day;

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

  -- ── Strength: gym sessions of 20+ minutes, all time ────────────────────────
  for r in
    select user_id, count(*)::int as n from public._honour_sessions('2000-01-01', now())
     where type = 'gym' and duration_sec >= 1200 group by user_id
  loop
    perform public._honour_set(r.user_id, 'strength', r.n);
  end loop;

  -- ── The Hive: friends who joined with your code and worked out ─────────────
  -- Active: 4+ active days in their first 30 days on POWR.
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
revoke all on function public._honour_set(uuid, text, int, jsonb) from public, anon, authenticated;
revoke all on function public._honour_sessions(timestamptz, timestamptz) from public, anon, authenticated;

-- ── Reading ──────────────────────────────────────────────────────────────────

-- The board's rows in one call. King first, then by metal, newest first.
create or replace function public.get_honours(p_users uuid[])
returns table (user_id uuid, kind text, tier text, count int, detail jsonb, earned_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select h.user_id, h.kind, h.tier, h.count, h.detail, h.earned_at
    from public.honours h
   where h.user_id = any (p_users)
     and auth.uid() is not null
   order by h.user_id, (h.kind = 'king') desc, public._honour_rank(h.tier) desc, h.earned_at desc
$$;
grant execute on function public.get_honours(uuid[]) to authenticated;

insert into public.system_config (key, value, description)
values ('honours_bonus', 'off', 'Trophies pay bonus points to the wallet when on (500 / 2,000 / 7,500 / 15,000; King 5,000 a win).')
on conflict (key) do nothing;

select cron.unschedule('honours') where exists (select 1 from cron.job where jobname = 'honours');
-- 00:15 UTC: 00:15 London in winter, 01:15 in summer; past midnight either way.
select cron.schedule('honours', '15 0 * * *', $cron$ select public.award_honours() $cron$);
