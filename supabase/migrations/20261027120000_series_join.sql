-- The Series: you join it (Jamie, 27 Oct: "we should give them the option to
-- join in, just like we do with the live events").
--
-- Applies AFTER 20261026150000_series_start_line_crowd.sql (the Drop
-- migrations after that one don't touch the Series).
--
-- Until now every member was on the board: _series_points counted every
-- profile. Now you're on it once you JOIN: one tap, once a season, and you're
-- in every round of that season. series_entries holds who joined; everything
-- that counts or names members reads it:
--
--   _series_points           only members who joined the round's season before
--                            the round ended. The board, the pacers' seats,
--                            prizes, settling, Top city and the bounty all read
--                            it, so they follow.
--   get_series_board         + joined / join (the round joining puts you in);
--                            the top 3 for someone not in yet; the gym crown
--                            names members who joined.
--   get_series_invite_board  the start line and the invite race count members
--                            who joined; me.joined.
--   series_dispatch_pushes   moment pushes go to members who joined (passed and
--                            rival already read the board).
--   _series_lock_cities      locks the cities of members who joined.
--   admin_series_round_stats + joined.
--   _series_rounds_guard     a published round needs a season (you join a season).
--
-- Joining late loses nothing: Series points count from the round's start,
-- whenever you join. Joining after a round has ended never puts you in it
-- (joined_at < ends_at), so a round's results can't change after the fact.
-- There's no leaving, as with live events.
--
-- Ship the app first: a client from before this reads a missing `me` as "no
-- Series" (the old League) and the start line still says "You're in". The app
-- that knows about joining treats a board without `joined` as everyone in.
--
-- Idempotent: safe to run twice.

-- ── 1. Who joined ─────────────────────────────────────────────────────────────

create table if not exists public.series_entries (
  season_id uuid not null references public.series_seasons(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (season_id, user_id)
);
create index if not exists series_entries_user on public.series_entries (user_id);

alter table public.series_entries enable row level security;
drop policy if exists series_entries_read on public.series_entries;
create policy series_entries_read on public.series_entries
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
-- Writes only through join_series.

-- The round joining puts you in: the one on now, else the next one. Rounds
-- never overlap, so that's the first published round still to end.
create or replace function public._series_join_round()
returns public.series_rounds
language sql
stable
security definer
set search_path = public
as $$
  select * from public.series_rounds
   where published and ends_at > now()
   order by starts_at
   limit 1;
$$;

create or replace function public.join_series()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_round  public.series_rounds;
  v_season text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not public._series_enabled_for(v_uid) then
    raise exception 'The Series isn''t open yet' using errcode = 'P0001';
  end if;
  select * into v_round from public._series_join_round();
  if v_round.id is null or v_round.season_id is null then
    raise exception 'There''s no round to join yet' using errcode = 'P0001';
  end if;
  insert into public.series_entries (season_id, user_id)
  values (v_round.season_id, v_uid)
  on conflict do nothing;
  select s.name into v_season from public.series_seasons s where s.id = v_round.season_id;
  return jsonb_build_object(
    'joined', true,
    'season', v_season,
    'round', jsonb_build_object('slug', v_round.slug, 'name', v_round.name,
                                'starts_at', v_round.starts_at, 'ends_at', v_round.ends_at,
                                'draw_days', v_round.draw_days));
end;
$$;

-- ── 2. The board counts members who joined ───────────────────────────────────

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
    select (starts_at at time zone 'Europe/London')::date as day1, season_id, ends_at
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
    from r
    -- Joined the round's season before the round ended (20261027120000).
    join public.series_entries e on e.season_id = r.season_id and e.joined_at < r.ends_at
    join public.profiles p on p.id = e.user_id
    cross join lon
    left join d on d.user_id = p.id
   where not public._series_is_demo(p.id)
     and not exists (select 1 from public.series_exclusions x
                      where x.user_id = p.id and (x.round_id is null or x.round_id = p_round))
   group by p.id, p.show_on_leaderboard, r.day1, lon.today;
$$;

-- ── 3. The League board: joined, the round to join, the crown ──────────────

create or replace function public.get_series_board(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_round  public.series_rounds;
  v_next   public.series_rounds;
  v_state  text;
  v_today  date := (now() at time zone 'Europe/London')::date;
  v_day1   date;
  v_gym    uuid;
  v_join   public.series_rounds;
  v_joined boolean;
  v_mon    date := date_trunc('week', now() at time zone 'Europe/London')::date;
  v_mon_ts timestamptz;
  v_out    jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  v_mon_ts := v_mon::timestamp at time zone 'Europe/London';

  -- Only published rounds reach the app; an admin can look at any by slug.
  if p_slug is not null then
    select * into v_round from public.series_rounds where slug = p_slug and (published or public.is_admin());
  else
    select * into v_round from public.series_rounds
     where published and now() >= starts_at and now() < ends_at order by starts_at limit 1;
    if v_round.id is null then
      select * into v_round from public.series_rounds where published and ends_at <= now() order by ends_at desc limit 1;
    end if;
    if v_round.id is null then
      select * into v_round from public.series_rounds where published order by starts_at limit 1;
    end if;
  end if;
  if v_round.id is null then
    return null;
  end if;
  v_state := case when now() < v_round.starts_at then 'upcoming'
                  when now() < v_round.ends_at then 'running'
                  else 'ended' end;
  select * into v_next from public.series_rounds where published and starts_at > now() order by starts_at limit 1;
  v_day1 := (v_round.starts_at at time zone 'Europe/London')::date;
  select preferred_gym_id into v_gym from public.profiles where id = v_uid;
  -- Joining: the round it puts you in (on now, else next) and whether you have.
  select * into v_join from public._series_join_round();
  v_joined := exists (select 1 from public.series_entries e
                       where e.season_id = v_join.season_id and e.user_id = v_uid);

  with pts as materialized (
    select * from public._series_field(v_round.id) where listed or user_id = v_uid
  ),
  ranked as (
    select pts.*,
           row_number() over (order by points desc, pacer, user_id)::int as rank,
           row_number() over (order by points_mid desc, pacer, user_id)::int as rank_mid
      from pts
  ),
  named as (
    select r.*,
           case when r.pacer then pc.name
                else coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') end as name,
           p.avatar_url,
           coalesce(p.country_code, pc.country_code) as country
      from ranked r
      left join public.profiles p on p.id = r.user_id and not r.pacer
      left join public.series_pacers pc on pc.id = r.user_id and r.pacer
  ),
  me as (select * from named where user_id = v_uid),
  friends as (
    select case when f.user_id = v_uid then f.friend_id else f.user_id end as friend_id
      from public.friendships f
     where f.status = 'accepted' and v_uid in (f.user_id, f.friend_id)
  ),
  -- Your rival is always a member, never a pacer: a friend just above you
  -- and within reach, else the nearest member above you (at #1, the nearest
  -- one chasing you). Pacers can sit in between. The 08:00 push names the
  -- same person (series_dispatch_pushes), so the phone and the app agree.
  rival as (
    select x.* from (
      (select n.user_id, n.name, n.rank, n.points, n.today, true as friend, 1 as pref
         from named n, me
        where n.rank < me.rank and n.points - me.points <= 30
          and n.user_id in (select friend_id from friends)
        order by n.rank desc limit 1)
      union all
      (select n.user_id, n.name, n.rank, n.points, n.today,
              n.user_id in (select friend_id from friends), 2
         from named n, me
        where not n.pacer and n.user_id <> me.user_id
          and case when me.rank = 1 then n.rank > me.rank else n.rank < me.rank end
        order by abs(n.rank - me.rank) limit 1)
    ) x
    order by x.pref limit 1
  ),
  -- Not in the round (yet): the top 3 on their own.
  shown as (
    select n.* from named n
     where n.rank <= 3
        or exists (select 1 from me where n.rank between me.rank - 1 and me.rank + 2)
  ),
  -- My city: everyone counts toward a city's size; its average (what ranks it,
  -- and the Top city prize) is real members' only.
  mc as materialized (
    select * from public._series_member_cities(v_round.id)
  ),
  city_people as (
    select mc.city, n.user_id, n.points, false as pacer
      from named n join mc on mc.user_id = n.user_id
     where not n.pacer
    union all
    select pc.city, n.user_id, n.points, true
      from named n join public.series_pacers pc on pc.id = n.user_id
     where n.pacer and pc.city is not null
  ),
  cities as (
    select cp.city,
           count(*)::int as members,
           count(*) filter (where not cp.pacer)::int as real_members,
           coalesce(round(avg(cp.points) filter (where not cp.pacer)), 0)::int as avg,
           bool_or(cp.user_id = v_uid) as you
      from city_people cp
     group by cp.city
  ),
  city_ranked as (
    select c.*, c.real_members >= v_round.city_min_members as ranked,
           row_number() over (order by (c.real_members >= v_round.city_min_members) desc, c.avg desc, c.members desc, c.city)::int as pos
      from cities c
  ),
  my_city as (
    select city, source, locked from mc where user_id = v_uid
  ),
  city_mine as (
    select cp.user_id,
           row_number() over (order by cp.points desc, cp.pacer, cp.user_id)::int as rank,
           count(*) over ()::int as members
      from city_people cp
     where cp.city = (select city from my_city)
  ),
  -- The crown: rolling 7 days, sessions verified AT your home gym, anyone's.
  court as (
    select l.user_id, coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') as name,
           (sum(l.pts) filter (where l.counts))::int as points
      from public._series_ledger(now() - interval '7 days', now()) l
      join public.profiles p on p.id = l.user_id
     where v_gym is not null and l.partner_id = v_gym
       and (coalesce(p.show_on_leaderboard, true) or p.id = v_uid)
       -- members who joined this round's season or the next one's (20261027120000)
       and exists (select 1 from public.series_entries e
                    where e.user_id = l.user_id and e.season_id in (v_round.season_id, v_join.season_id))
       -- members an admin took out of the round (series_exclusions, 20261022150000)
       and not exists (select 1 from public.series_exclusions x
                        where x.user_id = l.user_id and (x.round_id is null or x.round_id = v_round.id))
     group by l.user_id, p.display_name, p.username
    having (sum(l.pts) filter (where l.counts)) > 0
  ),
  court_ranked as (
    select c.*, row_number() over (order by c.points desc, c.user_id)::int as rank from court c
  ),
  -- Duels: this London week's points for you and your friends.
  wk as (
    select l.user_id, coalesce(sum(l.pts) filter (where l.counts), 0)::int as pts
      from public._series_ledger(v_mon_ts, v_mon_ts + interval '7 days') l
     where l.user_id = v_uid or l.user_id in (select friend_id from friends)
     group by l.user_id
  ),
  duels_now as (
    select d.*, case when d.challenger = v_uid then d.opponent else d.challenger end as other
      from public.series_duels d
     where v_uid in (d.challenger, d.opponent) and d.week_start = v_mon and d.status in ('pending', 'active')
  ),
  rec as (
    select case when d.challenger = v_uid then d.opponent else d.challenger end as other,
           count(*) filter (where d.winner = v_uid)::int as w,
           count(*) filter (where d.winner is not null and d.winner <> v_uid)::int as l
      from public.series_duels d
     where d.status = 'done' and v_uid in (d.challenger, d.opponent)
     group by 1
  ),
  people as (
    select p.id, coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') as name
      from public.profiles p
     where p.id in (select friend_id from friends)
  )
  select jsonb_build_object(
    'state', v_state,
    -- Whether you've joined, and the round joining puts you in (null: none to join).
    'joined', v_joined,
    'join', case when v_join.id is null or v_join.season_id is null or not public._series_enabled_for(v_uid) then null
                 else jsonb_build_object('slug', v_join.slug, 'name', v_join.name,
                                         'starts_at', v_join.starts_at, 'ends_at', v_join.ends_at,
                                         'draw_days', v_join.draw_days) end,
    'round', jsonb_build_object(
      'slug', v_round.slug,
      'name', v_round.name,
      'starts_at', v_round.starts_at,
      'ends_at', v_round.ends_at,
      'day', greatest(1, least((v_round.ends_at at time zone 'Europe/London')::date - v_day1, v_today - v_day1 + 1)),
      'days', (v_round.ends_at at time zone 'Europe/London')::date - v_day1,
      'draw_days', v_round.draw_days),
    'next', case when v_next.id is null then null
                 else jsonb_build_object('slug', v_next.slug, 'name', v_next.name, 'starts_at', v_next.starts_at) end,
    'total', (select count(*) from ranked),
    'me', (select jsonb_build_object('rank', rank, 'rank_mid', rank_mid, 'points', points, 'today', today, 'days', to_jsonb(days)) from me),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'user_id', user_id, 'name', name, 'avatar_url', avatar_url, 'country', country, 'rank', rank, 'rank_mid', rank_mid,
              'points', points, 'today', today, 'you', user_id = v_uid) order by rank) from shown), '[]'::jsonb),
    'rival', (select jsonb_build_object('user_id', user_id, 'name', name, 'rank', rank, 'points', points,
                                        'today', today, 'friend', friend) from rival),
    'city', jsonb_build_object(
      'you', (select jsonb_build_object('name', city, 'source', source, 'locked', locked) from my_city),
      'rank', (select rank from city_mine where user_id = v_uid),
      'members', (select members from city_mine where user_id = v_uid),
      'open', (select count(*) from city_ranked where ranked) >= v_round.city_min_cities,
      'min_cities', v_round.city_min_cities,
      'cities', coalesce((select jsonb_agg(jsonb_build_object(
                  'name', city, 'members', members, 'avg', avg, 'you', you) order by pos)
                  from city_ranked where ranked), '[]'::jsonb),
      'forming', (select count(*) from city_ranked where not ranked),
      -- The 30 cities with the most gyms; series_pick_city accepts any gym city.
      'options', case when exists (select 1 from my_city) or v_state = 'ended' then null
                      else to_jsonb((public._series_city_options())[1:30]) end),
    'gym', case when v_gym is null then null else jsonb_build_object(
              'id', v_gym,
              'name', (select pa.name from public.partners pa where pa.id = v_gym),
              'address', (select pa.address from public.partners pa where pa.id = v_gym),
              'people', (select count(*) from court_ranked),
              'court', coalesce((select jsonb_agg(jsonb_build_object(
                          'user_id', user_id, 'name', name, 'points', points, 'rank', rank, 'you', user_id = v_uid) order by rank)
                          from court_ranked where rank <= 5 or user_id = v_uid), '[]'::jsonb)) end,
    'duels', jsonb_build_object(
      'week_start', v_mon,
      'ends_at', (v_mon + 7)::timestamp at time zone 'Europe/London',
      'you', coalesce((select pts from wk where user_id = v_uid), 0),
      'active', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', d.id, 'user_id', d.other, 'name', pe.name,
                  'them', coalesce((select pts from wk where user_id = d.other), 0),
                  'w', coalesce(rc.w, 0), 'l', coalesce(rc.l, 0)) order by pe.name)
                  from duels_now d join people pe on pe.id = d.other left join rec rc on rc.other = d.other
                 where d.status = 'active'), '[]'::jsonb),
      'invites', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', d.id, 'user_id', d.other, 'name', pe.name,
                  'them', coalesce((select pts from wk where user_id = d.other), 0)))
                  from duels_now d join people pe on pe.id = d.other
                 where d.status = 'pending' and d.opponent = v_uid), '[]'::jsonb),
      'sent', coalesce((select jsonb_agg(d.other) from duels_now d
                 where d.status = 'pending' and d.challenger = v_uid), '[]'::jsonb),
      'open', coalesce((select jsonb_agg(jsonb_build_object('user_id', pe.id, 'name', pe.name) order by pe.name)
                  from people pe
                 where pe.id not in (select other from duels_now where status = 'active' or opponent = v_uid)), '[]'::jsonb))
  ) into v_out;

  return v_out;
end;
$$;

-- ── 4. The start line and the invite race ──────────────────────────────────

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
    -- fill it up to the board's day-1 size by the gun (see the header).
    'crowd', jsonb_build_object(
      'real', (select count(*) from members m where m.listed),
      'pacers_at_gun', least(
        (select count(*) from public.series_pacers sp where not sp.disabled),
        greatest(0, v_round.pacer_target - (select count(*) from members))),
      'ramp_from', coalesce(v_round.invite_from, v_round.starts_at - interval '14 days'),
      'ramp_to', v_round.starts_at,
      'base', 0.4),
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

-- ── 5. Moment pushes and city locks: members who joined ────────────────────

create or replace function public.series_dispatch_pushes(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round   public.series_rounds;
  v_series  text;
  v_token   text;
  v_targets jsonb := '[]'::jsonb;
  v_passed  int := 0;
  v_rival   int := 0;
  v_locked  int := 0;
  v_moments int := 0;
  m         record;
  v_batch   jsonb;
  v_n       int;
  v_on      text[];
  r         record;
begin
  select coalesce(array_agg(type), '{}') into v_on
    from public.notification_config
   where type in ('series_rival', 'series_passed', 'series_moment') and enabled;

  -- Duels run all year, so they close whether or not a round is on.
  if not p_dry_run then
    perform public._series_close_duels();
  end if;

  select * into v_round from public.series_rounds
   where published and now() >= starts_at and now() < ends_at order by starts_at limit 1;
  if v_round.id is null then
    return jsonb_build_object('round', null);
  end if;

  -- The season's name goes in every push ("… in the Winter Series").
  select s.name into v_series from public.series_seasons s where s.id = v_round.season_id;

  if not p_dry_run then
    v_locked := public._series_lock_cities(v_round.id);
  end if;

  -- A moment starting: one push to everyone the Series is on for, once. Only
  -- within half an hour of its start, so a late run never sends a stale one.
  -- Logged per person like the others, so it counts toward the day's ceiling
  -- (at most one moment push a day each, and never a third Series push).
  for m in
    select * from public.series_moments
     where round_id = v_round.id and push and pushed_at is null
       and starts_at <= now() and starts_at > now() - interval '30 minutes'
       and 'series_moment' = any (v_on)
  loop
    if p_dry_run then
      v_moments := v_moments + 1;
      continue;
    end if;
    update public.series_moments set pushed_at = now() where id = m.id;
    v_moments := v_moments + 1;
    with sent as (
      insert into public.series_push_log (user_id, kind, local_day)
      select p.id, 'moment', public._series_local_now(p.timezone)::date
        from public.series_entries e
        join public.profiles p on p.id = e.user_id
       where e.season_id = v_round.season_id
         and public._series_enabled_for(p.id) and not public._series_is_demo(p.id)
         and public._series_pushes_today(p.id, p.timezone) < public._series_push_cap()
      on conflict do nothing
      returning user_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'target_user_id', sent.user_id, 'type', 'series_moment',
             'payload', jsonb_build_object('title', m.name, 'body', coalesce(m.line, ''), 'kind', m.kind,
                                           'moment_id', m.id, 'series', v_series))), '[]'::jsonb)
      into v_batch
      from sent;
    v_targets := v_targets || v_batch;
  end loop;

  -- A member passed you since the last check. Never a pacer: the strongest
  -- push we send is never about someone who isn't there.
  for r in
    with st as materialized (
      select f.user_id, f.pacer, f.points, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
        from public._series_field(v_round.id) f
       where f.listed
    )
    select me.user_id, me.rank, me.points, a.points as by_points, pr.timezone,
           coalesce(nullif(trim(ap.display_name), ''), ap.username, apc.name, 'Someone') as by_name
      from st me
      join public.series_rank_snapshots sn on sn.round_id = v_round.id and sn.user_id = me.user_id
      -- The closest person above you now who was behind you last time: a big
      -- session can carry someone past several people at once.
      join lateral (
        select x.user_id, x.points
          from st x
          join public.series_rank_snapshots sx on sx.round_id = v_round.id and sx.user_id = x.user_id
         where x.rank < me.rank and sx.rank > sn.rank and not x.pacer
         order by x.rank desc
         limit 1
      ) a on true
      join public.profiles pr on pr.id = me.user_id
      left join public.profiles ap on ap.id = a.user_id
      left join public.series_pacers apc on apc.id = a.user_id
     where not me.pacer
       and me.rank > sn.rank
       and me.points > 0
       and 'series_passed' = any (v_on)
       and public._series_enabled_for(me.user_id)
       and public._series_pushes_today(me.user_id, pr.timezone) < public._series_push_cap()
       -- Blind Mode: nobody is told who passed them.
       and not exists (select 1 from public.series_moments b
                        where b.round_id = v_round.id and b.kind = 'blind'
                          and now() >= b.starts_at and now() < b.ends_at)
  loop
    if p_dry_run then
      v_passed := v_passed + 1;
      continue;
    end if;
    insert into public.series_push_log (user_id, kind, local_day)
    values (r.user_id, 'passed', public._series_local_now(r.timezone)::date)
    on conflict do nothing;
    if found then
      v_passed := v_passed + 1;
      v_targets := v_targets || jsonb_build_object(
        'target_user_id', r.user_id, 'type', 'series_passed',
        'payload', jsonb_build_object('name', r.by_name, 'rank', r.rank, 'gap', r.by_points - r.points, 'series', v_series));
    end if;
  end loop;

  -- The 08:00 rival push, in each person's own timezone. The rival is the one
  -- get_series_board shows: a friend within reach, else the nearest member
  -- (never a pacer). Skipped on a day a moment push is still to come, so the
  -- moment keeps its place under the ceiling.
  for r in
    with st as materialized (
      select f.user_id, f.pacer, f.points, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
        from public._series_field(v_round.id) f
       where f.listed
    )
    select me.user_id, me.rank, me.points, pr.timezone,
           coalesce(f.user_id, a.user_id) as rv_id,
           coalesce(f.points, a.points) as rv_points,
           (f.user_id is not null) as rv_friend
      from st me
      join public.profiles pr on pr.id = me.user_id
      left join lateral (
        select x.user_id, x.points from st x
         where x.rank < me.rank and x.points - me.points <= 30
           and exists (select 1 from public.friendships fs
                        where fs.status = 'accepted'
                          and fs.user_id = least(me.user_id, x.user_id)
                          and fs.friend_id = greatest(me.user_id, x.user_id))
         order by x.rank desc limit 1
      ) f on true
      left join lateral (
        select x.user_id, x.points from st x
         where not x.pacer and x.user_id <> me.user_id
           and case when me.rank = 1 then x.rank > me.rank else x.rank < me.rank end
         order by abs(x.rank - me.rank) limit 1
      ) a on true
     where not me.pacer
       and me.points > 0
       and 'series_rival' = any (v_on)
       and public._series_enabled_for(me.user_id)
       and public._series_local_now(pr.timezone)::time >= '08:00'
       and public._series_local_now(pr.timezone)::time < '08:15'
       and coalesce(f.user_id, a.user_id) is not null
       and public._series_pushes_today(me.user_id, pr.timezone) < public._series_push_cap()
       and not exists (select 1 from public.series_moments mm
                        where mm.round_id = v_round.id and mm.push and mm.pushed_at is null
                          and 'series_moment' = any (v_on)
                          and public._series_local_date(mm.starts_at, pr.timezone)
                              = public._series_local_now(pr.timezone)::date)
  loop
    if p_dry_run then
      v_rival := v_rival + 1;
      continue;
    end if;
    insert into public.series_push_log (user_id, kind, local_day)
    values (r.user_id, 'rival', public._series_local_now(r.timezone)::date)
    on conflict do nothing;
    if found then
      v_rival := v_rival + 1;
      v_targets := v_targets || jsonb_build_object(
        'target_user_id', r.user_id, 'type', 'series_rival',
        'payload', jsonb_build_object(
          'name', coalesce((select coalesce(nullif(trim(p.display_name), ''), p.username) from public.profiles p where p.id = r.rv_id),
                           'Your rival'),
          'gap', abs(r.rv_points - r.points),
          'ahead', r.rank = 1,
          'friend', r.rv_friend,
          'series', v_series));
    end if;
  end loop;

  if not p_dry_run then
    v_n := jsonb_array_length(v_targets);
    if v_n > 0 then
      select decrypted_secret into v_token from vault.decrypted_secrets where name = 'shared_resolve_token';
      -- send-push takes at most 200 targets a call.
      for i in 0 .. (v_n - 1) / 200 loop
        perform net.http_post(
          url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-resolve-token', v_token),
          body := jsonb_build_object('targets', (
            select jsonb_agg(e.t order by e.n)
              from jsonb_array_elements(v_targets) with ordinality as e(t, n)
             where e.n > i * 200 and e.n <= (i + 1) * 200)),
          timeout_milliseconds := 10000);
      end loop;
    end if;

    -- Remember where everyone stands for the next check (pacers too).
    insert into public.series_rank_snapshots (round_id, user_id, rank, points, taken_at)
    select v_round.id, s.user_id, s.rank, s.points, now()
      from (
        select f.user_id, f.points, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
          from public._series_field(v_round.id) f
         where f.listed
      ) s
    on conflict (round_id, user_id) do update
      set rank = excluded.rank, points = excluded.points, taken_at = excluded.taken_at;
  end if;

  return jsonb_build_object('round', v_round.slug, 'passed', v_passed, 'rival', v_rival,
                            'moments', v_moments, 'cities_locked', v_locked, 'dry_run', p_dry_run);
end;
$$;

create or replace function public._series_lock_cities(p_round uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  insert into public.series_cities (round_id, user_id, city, source)
  select p_round, p.id, pa.city, 'gym'
    from public.series_rounds r
    join public.series_entries e on e.season_id = r.season_id
    join public.profiles p on p.id = e.user_id
    join public.partners pa on pa.id = p.preferred_gym_id
   where r.id = p_round
     and pa.city is not null
     and not public._series_is_demo(p.id)
  on conflict (round_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 6. Admin: how many joined; a published round needs a season ───────────

create or replace function public.admin_series_round_stats(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_round public.series_rounds;
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_round from public.series_rounds
   where (p_slug is not null and slug = p_slug) or (p_slug is null and starts_at <= now())
   order by starts_at desc limit 1;
  if v_round.id is null then
    return null;
  end if;

  with field as materialized (select * from public._series_field(v_round.id) where listed),
  pts as (select * from field where not pacer)
  select jsonb_build_object(
    'round', v_round.slug,
    -- Everyone who joined in time for the round, shown on the board or not.
    'joined', (select count(*) from public.series_entries e
                where e.season_id = v_round.season_id and e.joined_at < v_round.ends_at),
    'entrants', (select count(*) from pts),
    'pacers_on_board', (select count(*) from field where pacer),
    'board_total', (select count(*) from field),
    'moved', (select count(*) from pts where points > 0),
    'in_the_draw', (select count(*) from pts where cardinality(days) >= v_round.draw_days),
    'avg_days_logged', (select round(avg(cardinality(days))::numeric, 1) from pts where points > 0),
    'week1_movers', (select count(*) from pts where exists (select 1 from unnest(days) d where d <= 7)),
    'came_back', (select count(*) from pts
                   where exists (select 1 from unnest(days) d where d <= 7)
                     and exists (select 1 from unnest(days) d where d >= 8)),
    -- Real members per city: what My city's gate counts.
    'cities', coalesce((select jsonb_object_agg(city, n) from (
                 select mc.city, count(*) as n
                   from public._series_member_cities(v_round.id) mc
                   join pts on pts.user_id = mc.user_id
                  group by mc.city) c), '{}'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

create or replace function public._series_rounds_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_clash  text;
  v_season public.series_seasons;
begin
  if new.ends_at <= new.starts_at then
    raise exception 'a round has to end after it starts' using errcode = 'P0001';
  end if;
  if new.ends_at - new.starts_at > interval '62 days' then
    raise exception 'a round can run for 62 days at most' using errcode = 'P0001';
  end if;
  if new.draw_days < 1 or new.pacer_target < 0 or new.pacer_growth < 0
     or new.city_min_members < 1 or new.city_min_cities < 1 then
    raise exception 'those numbers have to be positive' using errcode = 'P0001';
  end if;
  select r.name into v_clash from public.series_rounds r
   where r.id <> new.id
     and tstzrange(r.starts_at, r.ends_at) && tstzrange(new.starts_at, new.ends_at)
   limit 1;
  if v_clash is not null then
    raise exception 'these dates overlap %', v_clash using errcode = 'P0001';
  end if;
  -- Members join a season, so a round needs one to be joined (20261027120000).
  if new.published and new.season_id is null then
    raise exception 'put the round in a season before publishing it' using errcode = 'P0001';
  end if;
  if new.season_id is not null then
    select * into v_season from public.series_seasons where id = new.season_id;
    if (new.starts_at at time zone 'Europe/London')::date < v_season.starts_on
       or (new.ends_at at time zone 'Europe/London')::date - 1 > v_season.ends_on then
      raise exception 'the round has to sit inside % (% to %)', v_season.name, v_season.starts_on, v_season.ends_on using errcode = 'P0001';
    end if;
    if new.published and not v_season.published then
      raise exception 'publish % first' , v_season.name using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on function public._series_join_round() from public, anon, authenticated;
revoke all on function public.join_series() from public, anon;
grant execute on function public._series_join_round() to service_role;
grant execute on function public.join_series() to authenticated;
