-- ===========================================================================
-- profiles.flag_code — the flag a member SHOWS, kept apart from where they ARE.
--
-- WHY. Series boards drew the flag from profiles.country_code, which is
-- DERIVED (gps reverse-geocode, else timezone — 20260822090000_user_country).
-- That answers "which country is this phone in", and a flag next to a name
-- reads as "who I represent". For most members those match; for anyone living
-- abroad they don't. First report 2026-11-18: an Australian living in the UK
-- showing a Union Jack.
--
-- Overwriting country_code would not hold — the next gps reading (at most
-- 7 days away, see lib/country.ts) puts it straight back — and it would make
-- the market/segmentation numbers wrong for that member. So the choice gets
-- its own column, and the derivation never touches it:
--
--   · flag_code   — what the boards show. Member-chosen (or set by an admin
--                   on their behalf). NULL = no choice made.
--   · country_code — unchanged. Where the member is. Analytics only.
--
-- Boards show coalesce(flag_code, country_code), so nobody who hasn't chosen
-- sees any change.
--
-- ⚠ profiles is WORLD-READABLE, same as country_code. A two-letter code the
-- member chose to display publicly is fine there; nothing finer ever is.
-- ⚠ Like country_code, a member can UPDATE their own row, so this is a
-- display preference — never eligibility, never anything that pays out.
-- ===========================================================================

alter table public.profiles
  add column if not exists flag_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_flag_code_check') then
    alter table public.profiles
      add constraint profiles_flag_code_check check (flag_code ~ '^[A-Z]{2}$');
  end if;
end $$;

comment on column public.profiles.flag_code is
  'ISO 3166-1 alpha-2 the member CHOSE to show as their flag on boards. NULL = no choice; boards fall back to country_code. Never written by the country derivation, never used for eligibility.';

-- ---------------------------------------------------------------------------
-- The two Series boards: only the flag line changes —
--   coalesce(p.country_code, pc.country_code)
-- → coalesce(p.flag_code, p.country_code, pc.country_code)
-- Both bodies are the LIVE definitions as of 2026-11-18 (after
-- 20261118120000_series_trophy_push), so nothing else moves.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_series_board(p_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           coalesce(p.flag_code, p.country_code, pc.country_code) as country
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
  -- The top 20, and the one above you, you and the two below (not in the
  -- round yet: the top 20 on their own).
  shown as (
    select n.* from named n
     where n.rank <= 20
        or exists (select 1 from me where n.rank between me.rank - 1 and me.rank + 2)
  ),
  -- My city: everyone on the board counts toward a city, pacers too: its size,
  -- its average and whether it's ranked (20261116120000). The Top city prize
  -- is NOT decided here: _series_top_city ranks real members only.
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
           coalesce(round(avg(cp.points)), 0)::int as avg,
           bool_or(cp.user_id = v_uid) as you
      from city_people cp
     group by cp.city
  ),
  -- Ranked: enough people, and an average that isn't 0 (the first hours of a
  -- round, before anyone has moved, every city is still forming).
  city_flag as (
    select c.*, (c.members >= v_round.city_min_members and c.avg >= 1) as ranked
      from cities c
  ),
  city_ranked as (
    select c.*,
           row_number() over (order by c.ranked desc, c.avg desc, c.members desc, c.city)::int as pos
      from city_flag c
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_series_board(p_slug text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50, p_real_only boolean DEFAULT false, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_round public.series_rounds;
  v_q     text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_round from public.series_rounds where slug = p_slug;
  if v_round.id is null then
    return null;
  end if;

  with f as materialized (
    select * from public._series_field(v_round.id) where listed
  ),
  ranked as (
    select f.*,
           row_number() over (order by points desc, pacer, user_id)::int as rank,
           case when not pacer then row_number() over (partition by pacer order by points desc, user_id)::int end as real_rank
      from f
  ),
  named as (
    select r.*,
           case when r.pacer then pc.name else coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') end as name,
           p.username, p.referral_code,
           coalesce(p.flag_code, p.country_code, pc.country_code) as country,
           case when r.pacer then pc.city else mc.city end as city
      from ranked r
      left join public.profiles p on p.id = r.user_id and not r.pacer
      left join public.series_pacers pc on pc.id = r.user_id and r.pacer
      left join public._series_member_cities(v_round.id) mc on mc.user_id = r.user_id and not r.pacer
  ),
  hits as (
    select * from named n
     where (not p_real_only or not n.pacer)
       and (v_q is null
            or lower(n.name) like '%' || v_q || '%'
            or lower(coalesce(n.username, '')) like '%' || v_q || '%'
            or lower(coalesce(n.referral_code, '')) = replace(replace(v_q, ' ', ''), '-', ''))
  )
  select jsonb_build_object(
    'round', v_round.slug,
    'total', (select count(*) from f),
    'members', (select count(*) from f where not pacer),
    'pacers', (select count(*) from f where pacer),
    'matches', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'rank', h.rank, 'real_rank', h.real_rank, 'user_id', h.user_id, 'pacer', h.pacer,
              'name', h.name, 'member_id', h.referral_code, 'country', h.country, 'city', h.city,
              'points', h.points, 'today', h.today, 'days', cardinality(h.days)) order by h.rank)
              from (select * from hits order by rank offset greatest(0, p_offset) limit least(200, greatest(1, p_limit))) h),
              '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$
;

