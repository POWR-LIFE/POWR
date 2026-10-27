-- Series round prizes, renamed and cut to eight (Jamie, 2026-10-27).
--
-- Applies AFTER 20261026120000_series_invite_board.sql (it restates
-- _series_prize_order from there). Nothing in 20261027120000_series_join.sql
-- touches the prizes, so the two can go in either order.
--
--   1  Champion · Gold       #1                 ┐
--   2  Contender · Silver    #2                 ├ kind 'place' (as before)
--   3  Challenger · Bronze   #3                 ┘
--   4  Squad Builder         most friends brought in       kind 'patient_zero'
--   5  Unbreakable           most days in a row moving     kind 'hot_streak'
--   6  Level Up              most places climbed           kind 'biggest_mover'
--   7  Rookie of the Series  most Series points among      kind 'rookie' (new)
--                            members new to POWR: an account made in the 30
--                            days before the round, or during it
--   8  Every Move Counts     kind 'draw' (as before)
--
-- The names are the app's and /admin/series's; the kinds keep their old keys
-- (prod already has a 'patient_zero' prize row), so nothing renames data.
-- Most Wanted, Underdog and Photo Finish are gone, and with Most Wanted the
-- bounty (series_leads and its 15-minute cron) that only fed it.
--
--   1. prize and result kinds
--   2. the bounty, unscheduled and dropped
--   3. _series_prize_order restated: three branches out, Rookie in
--   4. _series_prize_kinds: the order prizes are given out in
--   5. get_series_prize_race restated: Rookie is sealed in Blind Mode too

-- ── 1. Kinds ─────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from public.series_prizes where kind in ('most_wanted', 'underdog', 'photo_finish'))
     or exists (select 1 from public.series_results where kind in ('most_wanted', 'underdog', 'photo_finish')) then
    raise exception 'a round still has a Most Wanted, Underdog or Photo Finish prize or result: remove it in /admin/series first'
      using errcode = 'P0001';
  end if;
end;
$$;

alter table public.series_prizes drop constraint if exists series_prizes_kind_check;
alter table public.series_prizes add constraint series_prizes_kind_check check (kind in (
  'place', 'draw', 'city', 'golden',
  'patient_zero', 'hot_streak', 'biggest_mover', 'rookie'));

alter table public.series_results drop constraint if exists series_results_kind_check;
alter table public.series_results add constraint series_results_kind_check check (kind in (
  'place', 'draw', 'city',
  'patient_zero', 'hot_streak', 'biggest_mover', 'rookie'));

-- ── 2. The bounty ────────────────────────────────────────────────────────────
-- Only Most Wanted read it. Nothing has been claimed: no round has run yet.

select cron.unschedule('series-leads') where exists (select 1 from cron.job where jobname = 'series-leads');
drop function if exists public._series_track_lead();
drop table if exists public.series_leads;

-- ── 3. Who's in line for each prize ──────────────────────────────────────────
-- Everyone eligible for `p_kind` in this round, best first (`ord`). Members
-- with Series points only. What `score` and `detail` mean depends on the prize:
--   place          points                 ·  —
--   patient_zero   friends brought in     ·  —
--   hot_streak     days in a row          ·  points
--   biggest_mover  places climbed         ·  your place after day 3
--   rookie         points                 ·  —
--   draw           days logged            ·  —  (ord is a fresh shuffle)
--   city           points                 ·  —  (the top city's members, shuffled)
-- Level Up has nobody in line until day 3 is over.
-- Restated from 20261026120000.

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
  -- The last full day before Level Up starts counting.
  v_from  := least(3, v_days);

  if p_kind = 'place' then
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      )
      select s.user_id, s.points, null::int, s.rnk from pts s;

  elsif p_kind = 'hot_streak' then
    -- Unbreakable: the longest run of days in a row with a paying session.
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

  elsif p_kind = 'biggest_mover' then
    -- Level Up: places climbed since the end of day 3, among the members who
    -- had points by then.
    if v_today <= v_from and not v_done then
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
         where d.day <= v_from
           and d.user_id in (select x.user_id from pts x)
         group by d.user_id
        having sum(d.pts) > 0
      ),
      before as (
        select c.user_id, row_number() over (order by c.pts desc, c.user_id)::int as rnk
          from cum c
      )
      select s.user_id, b.rnk - s.rnk, b.rnk,
             row_number() over (order by b.rnk - s.rnk desc, s.points desc, s.user_id)::int
        from before b join pts s on s.user_id = b.user_id
       where b.rnk - s.rnk > 0;

  elsif p_kind = 'patient_zero' then
    -- Squad Builder: friends who signed up with your code in the round's
    -- referral windows (_series_referral_windows: the invite period before it,
    -- The Plague) and logged a verified workout before the round ended.
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      ),
      win as (
        select w.starts_at, w.ends_at from public._series_referral_windows(p_round) w
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

  elsif p_kind = 'rookie' then
    -- Rookie of the Series: new to POWR (an account made in the 30 days
    -- before the round, or during it), most Series points.
    return query
      with pts as (
        select p.user_id, p.points, p.days, row_number() over (order by p.points desc, p.user_id)::int as rnk
          from public._series_points(p_round) p
         where p.listed and p.points > 0
      )
      select s.user_id, s.points, null::int,
             row_number() over (order by s.points desc, s.user_id)::int
        from pts s
        join public.profiles pr on pr.id = s.user_id
       where pr.created_at >= v_round.starts_at - interval '30 days'
         and pr.created_at < v_round.ends_at;

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

-- ── 4. The order prizes are given out in ─────────────────────────────────────
-- After the places: Squad Builder, Unbreakable, Level Up, Rookie of the Series.
-- Each goes to the first person in line who doesn't already hold one; the
-- draw and the city come last, from whoever's left. Settle, redraw and
-- get_series_results all read this, so none of them is restated.

create or replace function public._series_prize_kinds()
returns text[]
language sql
immutable
as $$ select array['patient_zero', 'hot_streak', 'biggest_mover', 'rookie'] $$;

-- ── 5. Who's on course, for the app ──────────────────────────────────────────
-- Restated from 20261025120000; only the Blind Mode line changed. Rookie ranks
-- by points, so it says nothing in the dark, like the places and Level Up.

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
    if v_blind and v_kind in ('place', 'biggest_mover', 'rookie') then
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
-- create or replace keeps the grants 20261025120000 gave; restated so this
-- file stands on its own.

revoke all on function public._series_prize_order(uuid, text) from public, anon, authenticated;
revoke all on function public._series_prize_kinds() from public, anon, authenticated;
revoke all on function public.get_series_prize_race(text) from public, anon;
grant execute on function public._series_prize_order(uuid, text) to service_role;
grant execute on function public._series_prize_kinds() to service_role;
grant execute on function public.get_series_prize_race(text) to authenticated;
