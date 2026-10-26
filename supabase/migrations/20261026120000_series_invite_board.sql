-- The invite board: a race before the round, on friends brought in.
--
-- Applies AFTER 20261025120000_series_round_prizes.sql.
--
-- Before a round opens there's nothing to rank, so the weeks before it are the
-- invite period: a board of who's brought in the most friends, and it counts
-- towards the round's Patient Zero. A friend counts once they've joined with
-- your code AND logged a verified workout (referrals.converted_at: manual logs
-- never convert), so sign-ups alone can't farm it; the ones still to work out
-- show as "joining". Real members only: pacers have no friends to bring.
-- Nothing here touches Series points: invites never buy rank on the board.
--
--   1. series_rounds.invite_from: when the round's invite period opens. Set
--      automatically on the next round the moment series_live goes 'on' (the
--      Series opening to members), editable in /admin/series.
--   2. _series_referral_windows(round): where Patient Zero counts friends:
--      the invite period, plus any Plague moments; neither = the whole round.
--   3. _series_prize_order restated: Patient Zero reads those windows.
--   4. get_series_invite_board(slug): the board for the app.

-- ── 1. The invite period ─────────────────────────────────────────────────────

alter table public.series_rounds add column if not exists invite_from timestamptz;
alter table public.series_rounds drop constraint if exists series_rounds_invite_before;
alter table public.series_rounds add constraint series_rounds_invite_before
  check (invite_from is null or invite_from < starts_at);

-- The Series opening to members opens the next round's invite period.
create or replace function public._series_open_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key = 'series_live' and new.value = 'on'
     and (tg_op = 'INSERT' or old.value is distinct from 'on') then
    update public.series_rounds set invite_from = now()
     where id = (select r.id from public.series_rounds r
                  where r.published and r.starts_at > now()
                  order by r.starts_at limit 1)
       and invite_from is null;
  end if;
  return new;
end;
$$;

drop trigger if exists series_live_opens_invites on public.system_config;
create trigger series_live_opens_invites
  after insert or update on public.system_config
  for each row execute function public._series_open_invites();

-- ── 2. Where Patient Zero counts ─────────────────────────────────────────────

create or replace function public._series_referral_windows(p_round uuid)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with r as (select * from public.series_rounds where id = p_round),
  plague as (
    select m.starts_at, m.ends_at from public.series_moments m, r
     where m.round_id = r.id and m.kind = 'plague'
  )
  -- Before the round: from the invite board opening to the gun.
  select r.invite_from, r.starts_at from r where r.invite_from is not null
  union all
  select p.starts_at, p.ends_at from plague p
  union all
  -- Neither: the whole round.
  select r.starts_at, r.ends_at from r
   where r.invite_from is null and not exists (select 1 from plague);
$$;

-- ── 3. Patient Zero reads the windows ────────────────────────────────────────
-- Restated from 20261025120000; only the patient_zero branch changed.

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
    -- Friends who signed up with your code in the round's referral windows
    -- (_series_referral_windows: the invite period before it, The Plague)
    -- and logged a verified workout before the round ended.
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

-- ── 4. The board ─────────────────────────────────────────────────────────────
-- The next round's invite board (or a round by slug): the top 10 and you, how
-- many are still on the start line (no friend in yet), and your own counts and
-- POWR ID for the invite link. Ranked by friends brought in, then whoever got
-- there first. Hidden members (show_on_leaderboard off) keep their place but
-- only see their own row.

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
  members as (
    select p.id, coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') as name,
           coalesce(p.show_on_leaderboard, true) as listed
      from public.profiles p
     where not public._series_is_demo(p.id)
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
    'me', jsonb_build_object(
      'rank', (select k.rank from ranked k where k.user_id = v_uid),
      'friends', coalesce((select p.friends from per p where p.user_id = v_uid), 0),
      'joining', coalesce((select p.joining from per p where p.user_id = v_uid), 0),
      'code', (select pr.referral_code from public.profiles pr where pr.id = v_uid))
  ) into v_out;
  return v_out;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on function public._series_open_invites() from public, anon, authenticated;
revoke all on function public._series_referral_windows(uuid) from public, anon, authenticated;
revoke all on function public.get_series_invite_board(text) from public, anon;
grant execute on function public._series_referral_windows(uuid) to service_role;
grant execute on function public.get_series_invite_board(text) to authenticated;
