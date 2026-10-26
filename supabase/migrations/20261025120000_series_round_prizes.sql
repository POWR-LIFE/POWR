-- Series round prizes: ten ways to win, one prize per person.
--
-- Applies AFTER 20261024120000_series_push_ceiling.sql (and every Series
-- migration before it). Scoring doesn't change: _series_points is restated on
-- top of a new per-day breakdown that gives the same totals.
--
--   1  Champion        #1            ┐
--   2  Runner-up       #2            ├ kind 'place' (as before)
--   3  Podium          #3            ┘
--   4  Most Wanted     most bounties claimed (taking the lead from a member)
--   5  Hot Streak      longest run of days in a row with a paying session
--   6  Biggest Mover   most places climbed since the end of day 3
--   7  Underdog        best finish from the bottom half at halfway
--   8  Patient Zero    most friends brought in during The Plague (they must
--                      log a verified workout before the round ends)
--   9  Photo Finish    most Series points on the last day
--  10  Every Move Counts  kind 'draw' (as before): a draw among everyone
--                      active on draw_days of the round's days
--
-- One prize per person: results are worked out in that order, and anyone who
-- already holds a prize is passed over for the next one (a unique index makes
-- it a rule, not a habit). Places and the draw pay with or without a prize row,
-- as before; every other prize, and now the top city too, only when the round
-- has that prize set in /admin/series. The Golden P stays a kind admins can
-- set but nothing awards it.
--
-- Every ranking here is members only (_series_points): pacers never win,
-- never count as a place climbed, and never sit in anyone's "bottom half".
--
-- What's new:
--   1. prize and result kinds; one result per person per round
--   2. The Plague (a moment kind: no boost, it marks the Patient Zero window)
--   3. _series_day_points (Series points per member per round day);
--      _series_points restated on it
--   4. the bounty: series_leads + _series_track_lead on a 15-minute cron
--   5. _series_prize_order: who's in line for each prize
--   6. admin_series_settle / admin_series_redraw restated with the new prizes
--      and the one-each rule; get_series_results orders by prize
--   7. get_series_prize_race: who's on course for each prize, for the app

-- ── 1. Kinds, and one prize each ─────────────────────────────────────────────

alter table public.series_prizes drop constraint if exists series_prizes_kind_check;
alter table public.series_prizes add constraint series_prizes_kind_check check (kind in (
  'place', 'draw', 'city', 'golden',
  'most_wanted', 'hot_streak', 'biggest_mover', 'underdog', 'patient_zero', 'photo_finish'));
-- A named prize goes to one person (the draw, the top city and the Golden P,
-- first 10 to find it, can have several).
alter table public.series_prizes drop constraint if exists series_prizes_one_winner;
alter table public.series_prizes add constraint series_prizes_one_winner check (kind in ('draw', 'city', 'golden') or winners = 1);

alter table public.series_results drop constraint if exists series_results_kind_check;
alter table public.series_results add constraint series_results_kind_check check (kind in (
  'place', 'draw', 'city',
  'most_wanted', 'hot_streak', 'biggest_mover', 'underdog', 'patient_zero', 'photo_finish'));
-- What won it: points on the last day, days in a row, places climbed …
alter table public.series_results add column if not exists score int;

create unique index if not exists series_results_one_each
  on public.series_results (round_id, user_id) where status <> 'void';

-- ── 2. The Plague ────────────────────────────────────────────────────────────

alter table public.series_moments drop constraint if exists series_moments_kind_check;
alter table public.series_moments add constraint series_moments_kind_check check (kind in (
  'gun', 'double_down', 'event_night', 'power_hour', 'all_in', 'blind', 'plague'));

create or replace function public._series_moments_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_round public.series_rounds;
begin
  select * into v_round from public.series_rounds where id = new.round_id;
  if new.starts_at < v_round.starts_at or new.ends_at > v_round.ends_at then
    raise exception 'a moment has to sit inside % (% to %)', v_round.name,
      (v_round.starts_at at time zone 'Europe/London')::date, (v_round.ends_at at time zone 'Europe/London')::date - 1
      using errcode = 'P0001';
  end if;
  -- No boost: The Gun starts the round, Blind Mode hides ranks, The Plague
  -- is the window Patient Zero counts friends in.
  if new.kind in ('gun', 'blind', 'plague') then
    new.multiplier := 1;
  elsif new.multiplier <= 1 then
    raise exception 'a boost needs a multiplier above ×1' using errcode = 'P0001';
  end if;
  if new.kind = 'event_night' and new.partner_id is null then
    raise exception 'pick the venue for event night' using errcode = 'P0001';
  end if;
  if new.kind = 'all_in' and new.top_n is null then
    raise exception 'say who misses out (the top N)' using errcode = 'P0001';
  end if;
  if new.kind = 'double_down' and new.activities is not null then
    -- Every name has to be a real activity type.
    perform new.activities::public.activity_type[];
  end if;
  if new.kind <> 'double_down' then new.activities := null; end if;
  if new.kind <> 'event_night' then new.partner_id := null; end if;
  if new.kind <> 'all_in' then new.top_n := null; end if;
  if tg_op = 'UPDATE' and new.starts_at is distinct from old.starts_at then
    new.pushed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ── 3. Series points by day ──────────────────────────────────────────────────
-- The scoring rule from 20261023090000, per member per round day (1 = the
-- round's first London day). `pts` is what counts on the board that day,
-- boosts included; `paid` is any session that paid at all (what counts as a
-- day logged, for the draw and Hot Streak). _series_points sums this, so the
-- board and the prizes can never score differently.

create or replace function public._series_day_points(p_round uuid)
returns table (
  user_id uuid,
  day     int,
  pts     int,
  paid    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select starts_at, ends_at, (starts_at at time zone 'Europe/London')::date as day1
      from public.series_rounds where id = p_round
  ),
  led as materialized (
    select l.* from r, public._series_ledger(r.starts_at, r.ends_at) l
  ),
  mo as (
    select * from public.series_moments where round_id = p_round and multiplier > 1
  ),
  -- All In: who was in the top N (by Series points before it started) and so misses out.
  allin_top as (
    select m.id as moment_id, x.user_id
      from mo m
      cross join lateral (
        select l.user_id from led l
         where l.started_at < m.starts_at and l.counts
         group by l.user_id
         order by sum(l.pts) desc, l.user_id
         limit m.top_n) x
     where m.kind = 'all_in'
  ),
  scored as (
    select l.*,
           round(l.pts * coalesce((
             select max(m.multiplier) from mo m
              where l.started_at >= m.starts_at and l.started_at < m.ends_at
                and (m.kind <> 'double_down' or m.activities is null or l.type::text = any (m.activities))
                and (m.kind <> 'event_night' or l.partner_id = m.partner_id)
                and (m.kind <> 'all_in' or not exists (
                       select 1 from allin_top t where t.moment_id = m.id and t.user_id = l.user_id))
           ), 1))::int as spts
      from led l
  )
  select l.user_id, (l.day - r.day1 + 1)::int,
         coalesce(sum(l.spts) filter (where l.counts), 0)::int,
         bool_or(l.pts > 0)
    from scored l
    cross join r
   where not exists (select 1 from public.series_exclusions x
                      where x.user_id = l.user_id and (x.round_id is null or x.round_id = p_round))
   group by l.user_id, l.day, r.day1;
$$;

create or replace function public._series_points(p_round uuid)
returns table (
  user_id    uuid,
  listed     boolean,
  points     int,
  -- at the start of today (London): the ▲/▼ next to a rank is places since midnight
  points_mid int,
  today      int,
  -- days of the round (1 = its first day) with at least one paying session
  days       int[]
)
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select (starts_at at time zone 'Europe/London')::date as day1
      from public.series_rounds where id = p_round
  ),
  lon as (select (now() at time zone 'Europe/London')::date as today),
  d as materialized (select * from public._series_day_points(p_round))
  select p.id,
         coalesce(p.show_on_leaderboard, true),
         coalesce(sum(d.pts), 0)::int,
         coalesce(sum(d.pts) filter (where d.day < lon.today - r.day1 + 1), 0)::int,
         coalesce(sum(d.pts) filter (where d.day = lon.today - r.day1 + 1), 0)::int,
         coalesce(array_agg(distinct d.day) filter (where d.paid), '{}'::int[])
    from public.profiles p
    cross join r
    cross join lon
    left join d on d.user_id = p.id
   where not public._series_is_demo(p.id)
     and not exists (select 1 from public.series_exclusions x
                      where x.user_id = p.id and (x.round_id is null or x.round_id = p_round))
   group by p.id, p.show_on_leaderboard, r.day1, lon.today;
$$;

-- ── 4. The bounty ────────────────────────────────────────────────────────────
-- Whoever leads carries a bounty; take the lead from them and you've claimed
-- it. A bounty is a count for Most Wanted, never points, so it can't move
-- anyone up the board. Checked every 15 minutes, paused while Blind Mode is on
-- (a lead taken in the dark is claimed when the ranks come back).

create table if not exists public.series_leads (
  id           bigserial primary key,
  round_id     uuid not null references public.series_rounds(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- Who they took it from; null for the round's first leader (nothing to claim).
  from_user_id uuid references public.profiles(id) on delete set null,
  taken_at     timestamptz not null default now()
);
create index if not exists series_leads_round on public.series_leads (round_id, taken_at desc, id desc);
alter table public.series_leads enable row level security;
-- No policies: read through the definer functions below.

create or replace function public._series_track_lead()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.series_rounds;
  v_lead  uuid;
  v_prev  uuid;
  v_n     int := 0;
begin
  for v_round in
    select * from public.series_rounds where published and now() >= starts_at and now() < ends_at
  loop
    continue when exists (select 1 from public.series_moments b
                           where b.round_id = v_round.id and b.kind = 'blind'
                             and now() >= b.starts_at and now() < b.ends_at);
    select p.user_id into v_lead
      from public._series_points(v_round.id) p
     where p.listed and p.points > 0
     order by p.points desc, p.user_id
     limit 1;
    continue when v_lead is null;
    select l.user_id into v_prev
      from public.series_leads l
     where l.round_id = v_round.id
     order by l.taken_at desc, l.id desc
     limit 1;
    if v_prev is distinct from v_lead then
      insert into public.series_leads (round_id, user_id, from_user_id) values (v_round.id, v_lead, v_prev);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

select cron.schedule('series-leads', '*/15 * * * *', $cron$ select public._series_track_lead() $cron$);

-- ── 5. Who's in line for each prize ──────────────────────────────────────────
-- Everyone eligible for `p_kind` in this round, best first (`ord`). Members
-- with Series points only. What `score` and `detail` mean depends on the prize:
--   place          points                 ·  —
--   most_wanted    bounties claimed       ·  points
--   hot_streak     days in a row          ·  points
--   biggest_mover  places climbed         ·  your place after day 3
--   underdog       your place now         ·  your place at halfway
--   patient_zero   friends brought in     ·  —
--   photo_finish   points on the last day ·  points
--   draw           days logged            ·  —  (ord is a fresh shuffle)
--   city           points                 ·  —  (the top city's members, shuffled)
-- A prize whose moment hasn't come yet (Biggest Mover before day 3 is over,
-- Underdog before halfway, Photo Finish before the last day) has nobody in line.

create or replace function public._series_prize_order(p_round uuid, p_kind text)
returns table (user_id uuid, score int, detail int, ord int)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_round  public.series_rounds;
  v_day1   date;
  v_days   int;
  v_today  int;
  v_done   boolean;
  v_from   int;
  v_half   int;
  v_city   text;
begin
  select * into v_round from public.series_rounds where id = p_round;
  if v_round.id is null then
    return;
  end if;
  v_day1  := (v_round.starts_at at time zone 'Europe/London')::date;
  v_days  := (v_round.ends_at at time zone 'Europe/London')::date - v_day1;
  v_today := (now() at time zone 'Europe/London')::date - v_day1 + 1;
  v_done  := now() >= v_round.ends_at;
  -- The last full day that counts toward a "since day N" prize.
  v_from  := least(3, v_days);
  v_half  := greatest(1, v_days / 2);

  if p_kind = 'place' then
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      )
      select s.user_id, s.points, null::int, s.rnk from pts s;

  elsif p_kind = 'most_wanted' then
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      )
      select s.user_id, c.n, s.points,
             row_number() over (order by c.n desc, s.points desc, s.user_id)::int
        from pts s
        join (select l.user_id, count(*)::int as n from public.series_leads l
               where l.round_id = p_round and l.from_user_id is not null
               group by l.user_id) c on c.user_id = s.user_id;

  elsif p_kind = 'hot_streak' then
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      ),
      runs as (
        select s.user_id, max(g.n)::int as best
          from pts s
          cross join lateral (
            select count(*) as n
              from (select d, d - row_number() over (order by d) as grp from unnest(s.days) d) x
             group by x.grp) g
         group by s.user_id
      )
      select s.user_id, r.best, s.points,
             row_number() over (order by r.best desc, s.points desc, s.user_id)::int
        from pts s join runs r on r.user_id = s.user_id
       where r.best > 0;

  elsif p_kind = 'photo_finish' then
    if v_today < v_days and not v_done then
      return;
    end if;
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      )
      select s.user_id, d.pts, s.points,
             row_number() over (order by d.pts desc, s.points desc, s.user_id)::int
        from pts s
        join public._series_day_points(p_round) d on d.user_id = s.user_id and d.day = v_days
       where d.pts > 0;

  elsif p_kind in ('biggest_mover', 'underdog') then
    -- Places at the end of a day, among the members who had points by then.
    if v_today <= (case p_kind when 'biggest_mover' then v_from else v_half end) and not v_done then
      return;
    end if;
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      ),
      cum as (
        select d.user_id, sum(d.pts)::int as pts
          from public._series_day_points(p_round) d
         where d.day <= case p_kind when 'biggest_mover' then v_from else v_half end
           and d.user_id in (select x.user_id from pts x)
         group by d.user_id
        having sum(d.pts) > 0
      ),
      before as (
        select c.user_id, row_number() over (order by c.pts desc, c.user_id)::int as rnk,
               count(*) over ()::int as n
          from cum c
      )
      select s.user_id,
             case when p_kind = 'biggest_mover' then b.rnk - s.rnk else s.rnk end,
             b.rnk,
             row_number() over (order by
               case when p_kind = 'biggest_mover' then b.rnk - s.rnk else -s.rnk end desc,
               s.points desc, s.user_id)::int
        from before b join pts s on s.user_id = b.user_id
       where case when p_kind = 'biggest_mover' then b.rnk - s.rnk > 0 else b.rnk * 2 > b.n end;

  elsif p_kind = 'patient_zero' then
    -- Friends who signed up with your code during The Plague (the whole round
    -- if it has none) and logged a verified workout before the round ended.
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      ),
      win as (
        select m.starts_at, m.ends_at from public.series_moments m
         where m.round_id = p_round and m.kind = 'plague'
        union all
        select v_round.starts_at, v_round.ends_at
         where not exists (select 1 from public.series_moments m where m.round_id = p_round and m.kind = 'plague')
      ),
      brought as (
        select rf.referrer_id as user_id, count(distinct rf.referred_id)::int as n, max(rf.converted_at) as reached
          from public.referrals rf
         where rf.converted_at is not null and rf.converted_at < v_round.ends_at
           and exists (select 1 from win w where rf.created_at >= w.starts_at and rf.created_at < w.ends_at)
           and not public._series_is_demo(rf.referred_id)
         group by rf.referrer_id
      )
      select s.user_id, b.n, null::int,
             row_number() over (order by b.n desc, b.reached, s.user_id)::int
        from pts s join brought b on b.user_id = s.user_id;

  elsif p_kind = 'draw' then
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      )
      select s.user_id, cardinality(s.days), null::int, row_number() over (order by random())::int
        from pts s
       where cardinality(s.days) >= v_round.draw_days;

  elsif p_kind = 'city' then
    v_city := public._series_top_city(p_round);
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      )
      select s.user_id, s.points, null::int, row_number() over (order by random())::int
        from pts s
        join public._series_member_cities(p_round) mc on mc.user_id = s.user_id
       where mc.city = v_city;
  end if;
end;
$$;

-- ── 6. Results ───────────────────────────────────────────────────────────────

-- The order prizes are given out in. Each goes to the first person in line who
-- doesn't already hold one; the draw and the city come last, from whoever's left.
create or replace function public._series_prize_kinds()
returns text[]
language sql
immutable
as $$ select array['most_wanted', 'hot_streak', 'biggest_mover', 'underdog', 'patient_zero', 'photo_finish'] $$;

create or replace function public.admin_series_settle(p_slug text, p_preview boolean default true, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_round  public.series_rounds;
  v_places int;
  v_draw   int;
  v_cityn  int;
  v_city   text;
  v_kind   text;
  v_out    jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_round from public.series_rounds where slug = p_slug;
  if v_round.id is null then
    raise exception 'no round called %', p_slug using errcode = 'P0001';
  end if;
  if not p_preview and now() < v_round.ends_at and not p_force then
    raise exception 'the round is still running (it ends %)', v_round.ends_at using errcode = 'P0001';
  end if;
  if not p_preview and exists (select 1 from public.series_results where round_id = v_round.id and status = 'confirmed') then
    raise exception 'results are already confirmed: redraw them one at a time' using errcode = 'P0001';
  end if;

  v_places := coalesce((select max(place) from public.series_prizes where round_id = v_round.id and kind = 'place'), 3);
  v_draw   := coalesce((select winners from public.series_prizes where round_id = v_round.id and kind = 'draw'), 3);
  -- The top city only pays when the round has a city prize.
  v_cityn  := coalesce((select winners from public.series_prizes where round_id = v_round.id and kind = 'city'), 0);
  v_city   := case when v_cityn > 0 then public._series_top_city(v_round.id) end;

  create temp table if not exists _series_award (
    seq int, kind text, place int, user_id uuid, score int, detail int, tied boolean
  ) on commit drop;
  delete from _series_award;

  -- 1–3 (or however many places have prizes): the top of the board.
  insert into _series_award
  select o.ord, 'place', o.ord, o.user_id, o.score, o.detail,
         exists (select 1 from public._series_prize_order(v_round.id, 'place') t where t.ord = o.ord + 1 and t.score = o.score)
    from public._series_prize_order(v_round.id, 'place') o
   where o.ord <= v_places;

  -- The named prizes, in order; nobody takes a second one.
  foreach v_kind in array public._series_prize_kinds() loop
    continue when not exists (select 1 from public.series_prizes where round_id = v_round.id and kind = v_kind);
    insert into _series_award
    select 100 + array_position(public._series_prize_kinds(), v_kind), v_kind, 1, o.user_id, o.score, o.detail, false
      from public._series_prize_order(v_round.id, v_kind) o
     where o.user_id not in (select a.user_id from _series_award a)
     order by o.ord
     limit 1;
    -- A tie: the next person in line has the same score and tie-break.
    update _series_award a set tied = exists (
      select 1 from public._series_prize_order(v_round.id, v_kind) t
       where t.user_id <> a.user_id and t.user_id not in (select b.user_id from _series_award b)
         and t.score = a.score and t.detail is not distinct from a.detail)
     where a.kind = v_kind;
  end loop;

  if v_city is not null then
    insert into _series_award
    select 200 + row_number() over (order by o.ord), 'city', row_number() over (order by o.ord)::int, o.user_id, o.score, null, false
      from public._series_prize_order(v_round.id, 'city') o
     where o.user_id not in (select a.user_id from _series_award a)
     order by o.ord
     limit v_cityn;
  end if;

  -- Every Move Counts: drawn last, from everyone eligible who hasn't won.
  insert into _series_award
  select 300 + row_number() over (order by o.ord), 'draw', row_number() over (order by o.ord)::int, o.user_id, o.score, null, false
    from public._series_prize_order(v_round.id, 'draw') o
   where o.user_id not in (select a.user_id from _series_award a)
   order by o.ord
   limit v_draw;

  if not p_preview then
    delete from public.series_results where round_id = v_round.id and status = 'provisional';
    insert into public.series_results (round_id, kind, place, user_id, prize_id, points, score, city, created_by)
    select v_round.id, a.kind, a.place, a.user_id,
           (select pr.id from public.series_prizes pr
             where pr.round_id = v_round.id and pr.kind = a.kind and (a.kind <> 'place' or pr.place = a.place)),
           coalesce((select p.points from public._series_points(v_round.id) p where p.user_id = a.user_id), 0),
           a.score,
           case when a.kind = 'city' then v_city end,
           v_uid
      from _series_award a
     order by a.seq;
  end if;

  select jsonb_build_object(
    'round', v_round.slug,
    'preview', p_preview,
    'running', now() < v_round.ends_at,
    'one_each', true,
    'places', coalesce((select jsonb_agg(jsonb_build_object(
                'place', a.place, 'user_id', a.user_id, 'points', a.score,
                'name', coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member'),
                'tied', a.tied)
                order by a.place)
                from _series_award a join public.profiles p on p.id = a.user_id
               where a.kind = 'place'), '[]'::jsonb),
    'prizes', coalesce((select jsonb_agg(jsonb_build_object(
                'kind', a.kind, 'user_id', a.user_id, 'score', a.score, 'detail', a.detail,
                'name', coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member'),
                'tied', a.tied)
                order by a.seq)
                from _series_award a join public.profiles p on p.id = a.user_id
               where a.kind = any (public._series_prize_kinds())), '[]'::jsonb),
    'draw', jsonb_build_object(
      'eligible', (select count(*) from public._series_prize_order(v_round.id, 'draw') o
                    where o.user_id not in (select a.user_id from _series_award a where a.kind <> 'draw')),
      'winners', v_draw,
      'days_needed', v_round.draw_days),
    'city', jsonb_build_object(
      'name', v_city,
      'eligible', case when v_city is null then 0 else (select count(*) from public._series_prize_order(v_round.id, 'city')) end,
      'winners', v_cityn),
    'results', case when p_preview then null else (select count(*) from public.series_results
                                                     where round_id = v_round.id and status = 'provisional') end
  ) into v_out;
  return v_out;
end;
$$;

-- Void one result and fill the gap, still one prize each. Places: everyone
-- below moves up one (with that place's prize) and the next member down who
-- holds no prize takes the last place. A named prize goes to the next in line
-- who holds none; the draw and the city are drawn again from whoever's left.
create or replace function public.admin_series_redraw(p_result uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_res   public.series_results;
  v_round public.series_rounds;
  v_new   record;
  v_slot  int;
  v_prize uuid;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'say why (it goes on the record)' using errcode = 'P0001';
  end if;
  select * into v_res from public.series_results where id = p_result and status <> 'void' for update;
  if v_res.id is null then
    raise exception 'no such result, or it is already void' using errcode = 'P0001';
  end if;
  select * into v_round from public.series_rounds where id = v_res.round_id;

  update public.series_results set status = 'void', void_reason = trim(p_reason) where id = v_res.id;

  v_slot := v_res.place;
  v_prize := v_res.prize_id;
  if v_res.kind = 'place' then
    -- In two steps so no two live results ever hold the same place mid-update.
    update public.series_results set place = place + 1000
     where round_id = v_round.id and kind = 'place' and status <> 'void' and place > v_res.place;
    update public.series_results x
       set place = x.place - 1001,
           prize_id = (select pr.id from public.series_prizes pr
                        where pr.round_id = v_round.id and pr.kind = 'place' and pr.place = x.place - 1001)
     where x.round_id = v_round.id and x.kind = 'place' and x.status <> 'void' and x.place > 1000;
    v_slot := coalesce((select max(place) from public.series_results
                         where round_id = v_round.id and kind = 'place' and status <> 'void'), 0) + 1;
    v_prize := (select pr.id from public.series_prizes pr
                 where pr.round_id = v_round.id and pr.kind = 'place' and pr.place = v_slot);
  end if;

  select o.user_id, o.score into v_new
    from public._series_prize_order(v_round.id, v_res.kind) o
   where o.user_id <> v_res.user_id
     -- the city prize stays with the city it was won for
     and (v_res.kind <> 'city' or exists (select 1 from public._series_member_cities(v_round.id) mc
                                           where mc.user_id = o.user_id and mc.city = v_res.city))
     and not exists (select 1 from public.series_results x
                      where x.round_id = v_round.id and x.user_id = o.user_id and x.status <> 'void')
   order by o.ord
   limit 1;

  if v_new.user_id is null then
    return jsonb_build_object('replaced', false);
  end if;

  insert into public.series_results (round_id, kind, place, user_id, prize_id, points, score, city, created_by)
  values (v_round.id, v_res.kind, v_slot, v_new.user_id, v_prize,
          coalesce((select p.points from public._series_points(v_round.id) p where p.user_id = v_new.user_id), 0),
          v_new.score, v_res.city, v_uid);

  return jsonb_build_object('replaced', true, 'user_id', v_new.user_id, 'place', v_slot,
    'name', (select coalesce(nullif(trim(display_name), ''), username, 'POWR member') from public.profiles where id = v_new.user_id));
end;
$$;

create or replace function public.get_series_results(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_round public.series_rounds;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select r.* into v_round from public.series_rounds r
   where r.published
     and (p_slug is null or r.slug = p_slug)
     and exists (select 1 from public.series_results x where x.round_id = r.id and x.announced_at is not null)
   order by r.ends_at desc limit 1;
  if v_round.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'round', jsonb_build_object('slug', v_round.slug, 'name', v_round.name, 'ends_at', v_round.ends_at),
    'winners', coalesce((select jsonb_agg(jsonb_build_object(
                 'kind', x.kind, 'place', x.place,
                 'name', coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member'),
                 'points', x.points, 'score', x.score, 'city', x.city, 'you', x.user_id = v_uid,
                 'prize', pr.name, 'sponsor', pr.sponsor, 'image_url', pr.image_url)
                 order by case x.kind when 'place' then 0 when 'city' then 50 when 'draw' then 60
                            else coalesce(array_position(public._series_prize_kinds(), x.kind), 40) end,
                          x.place)
                 from public.series_results x
                 join public.profiles p on p.id = x.user_id
                 left join public.series_prizes pr on pr.id = x.prize_id
                where x.round_id = v_round.id and x.status = 'confirmed' and x.announced_at is not null), '[]'::jsonb)
  );
end;
$$;

-- ── 7. Who's on course, for the app ──────────────────────────────────────────
-- For each prize the round has: who's first in line right now and where you
-- stand. Names are members on the board only (show_on_leaderboard). While
-- Blind Mode is on, the prizes that give away places say nothing.

create or replace function public.get_series_prize_race(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_round public.series_rounds;
  v_blind boolean;
  v_kinds text[];
  v_kind  text;
  v_out   jsonb := '[]'::jsonb;
  v_lead  record;
  v_me    record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_slug is not null then
    select * into v_round from public.series_rounds where slug = p_slug and (published or public.is_admin());
  else
    select * into v_round from public.series_rounds
     where published and now() >= starts_at and now() < ends_at order by starts_at limit 1;
  end if;
  if v_round.id is null then
    return null;
  end if;
  v_blind := exists (select 1 from public.series_moments b
                      where b.round_id = v_round.id and b.kind = 'blind' and now() >= b.starts_at and now() < b.ends_at);
  v_kinds := array['place'] || array(
    select k from unnest(public._series_prize_kinds()) with ordinality u(k, i)
     where exists (select 1 from public.series_prizes pr where pr.round_id = v_round.id and pr.kind = u.k)
     order by u.i);

  foreach v_kind in array v_kinds loop
    if v_blind and v_kind in ('place', 'biggest_mover', 'underdog') then
      v_out := v_out || jsonb_build_object('kind', v_kind, 'sealed', true);
      continue;
    end if;
    select o.user_id, o.score, o.detail into v_lead
      from public._series_prize_order(v_round.id, v_kind) o order by o.ord limit 1;
    select o.score, o.detail, o.ord into v_me
      from public._series_prize_order(v_round.id, v_kind) o where o.user_id = v_uid;
    v_out := v_out || jsonb_build_object(
      'kind', v_kind,
      'leader', case when v_lead.user_id is null then null else jsonb_build_object(
                  'name', (select coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member')
                             from public.profiles p where p.id = v_lead.user_id),
                  'score', v_lead.score, 'detail', v_lead.detail, 'you', v_lead.user_id = v_uid) end,
      'you', case when v_me.ord is null then null else jsonb_build_object(
               'score', v_me.score, 'detail', v_me.detail, 'ord', v_me.ord) end);
  end loop;

  return jsonb_build_object('round', v_round.slug, 'blind', v_blind, 'prizes', v_out);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on function public._series_day_points(uuid) from public, anon, authenticated;
revoke all on function public._series_track_lead() from public, anon, authenticated;
revoke all on function public._series_prize_order(uuid, text) from public, anon, authenticated;
revoke all on function public._series_prize_kinds() from public, anon, authenticated;
revoke all on function public.get_series_prize_race(text) from public, anon;
grant execute on function public._series_day_points(uuid) to service_role;
grant execute on function public._series_track_lead() to service_role;
grant execute on function public._series_prize_order(uuid, text) to service_role;
grant execute on function public._series_prize_kinds() to service_role;
grant execute on function public.get_series_prize_race(text) to authenticated;
