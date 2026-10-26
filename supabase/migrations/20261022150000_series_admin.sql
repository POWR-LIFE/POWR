-- The Autumn Series, run from /admin/series. Applies after
-- 20261020150000_autumn_series.sql and 20261022120000_series_pacers_and_cities.sql.
--
--   1. Rounds: admins write series_rounds directly (RLS). A guard refuses an
--      overlapping or back-to-front round; new dates re-plan the pacers.
--   2. series_prizes          what a round gives away: places, The Draw, the
--                             top city, the Golden P
--   3. series_exclusions      members taken out of a round, or every round
--   4. _series_points         now leaves excluded members out (so the board,
--                             cities, pushes, stats and results all do)
--   5. series_results         the winners: admin_series_settle (preview, then
--                             draw), admin_series_redraw, _confirm, _announce
--   6. admin reads            admin_series_board, admin_series_cities,
--                             admin_series_pacers
--   7. admin writes           exclude / include a member, set a member's city
--   8. get_series_results     the winners, for the app, once announced
--
-- Every result is drawn from REAL members only: _series_points never holds a
-- pacer, so no pacer can be settled into a prize.

-- ── 1. Rounds ────────────────────────────────────────────────────────────────

drop policy if exists series_rounds_read on public.series_rounds;
create policy series_rounds_read on public.series_rounds
  for select to authenticated using (published or (select public.is_admin()));
drop policy if exists series_rounds_admin on public.series_rounds;
create policy series_rounds_admin on public.series_rounds
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public._series_rounds_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_clash text;
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
  return new;
end;
$$;

drop trigger if exists series_rounds_guard on public.series_rounds;
create trigger series_rounds_guard
  before insert or update on public.series_rounds
  for each row execute function public._series_rounds_guard();

-- New dates, new pacer plan (a plan is one row per pacer per day of the round).
drop trigger if exists series_rounds_replan on public.series_rounds;
create trigger series_rounds_replan
  after update of starts_at, ends_at on public.series_rounds
  for each row
  when (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at)
  execute function public._series_plan_pacers_on_insert();

-- Admins can see and switch off pacers (the list is read straight from the table).
drop policy if exists series_pacers_admin_read on public.series_pacers;
create policy series_pacers_admin_read on public.series_pacers
  for select to authenticated using ((select public.is_admin()));
drop policy if exists series_pacers_admin_update on public.series_pacers;
create policy series_pacers_admin_update on public.series_pacers
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── 2. Prizes ────────────────────────────────────────────────────────────────

create table if not exists public.series_prizes (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.series_rounds(id) on delete cascade,
  -- place = a finishing place · draw = The Draw · city = the top city · golden = the Golden P
  kind       text not null check (kind in ('place', 'draw', 'city', 'golden')),
  -- 1 = 1st, for kind place only
  place      int check (place between 1 and 50),
  name       text not null check (length(trim(name)) between 1 and 120),
  sponsor    text check (sponsor is null or length(sponsor) <= 120),
  detail     text check (detail is null or length(detail) <= 240),
  image_url  text,
  -- How many win it: The Draw's hampers, the top city's members. A place is one person.
  winners    int not null default 1 check (winners between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'place') = (place is not null)),
  check (kind <> 'place' or winners = 1)
);
create unique index if not exists series_prizes_place on public.series_prizes (round_id, place) where kind = 'place';
create unique index if not exists series_prizes_one on public.series_prizes (round_id, kind) where kind <> 'place';

alter table public.series_prizes enable row level security;
drop policy if exists series_prizes_read on public.series_prizes;
create policy series_prizes_read on public.series_prizes
  for select to authenticated
  using (exists (select 1 from public.series_rounds r where r.id = round_id and r.published)
         or (select public.is_admin()));
drop policy if exists series_prizes_admin on public.series_prizes;
create policy series_prizes_admin on public.series_prizes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── 3. Exclusions ────────────────────────────────────────────────────────────

create table if not exists public.series_exclusions (
  id         uuid primary key default gen_random_uuid(),
  -- null = every round
  round_id   uuid references public.series_rounds(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text not null check (length(trim(reason)) between 3 and 300),
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists series_exclusions_one
  on public.series_exclusions (user_id, coalesce(round_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.series_exclusions enable row level security;
drop policy if exists series_exclusions_admin_read on public.series_exclusions;
create policy series_exclusions_admin_read on public.series_exclusions
  for select to authenticated using ((select public.is_admin()));
-- Writes only through admin_series_exclude / admin_series_include.

-- ── 4. Totals without the excluded ───────────────────────────────────────────

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
    select starts_at, ends_at, (starts_at at time zone 'Europe/London')::date as day1
      from public.series_rounds where id = p_round
  ),
  led as (
    select l.* from r, public._series_ledger(r.starts_at, r.ends_at) l
  ),
  lon as (select (now() at time zone 'Europe/London')::date as today)
  select p.id,
         coalesce(p.show_on_leaderboard, true),
         coalesce(sum(l.pts) filter (where l.counts), 0)::int,
         coalesce(sum(l.pts) filter (where l.counts and l.day < lon.today), 0)::int,
         coalesce(sum(l.pts) filter (where l.counts and l.day = lon.today), 0)::int,
         coalesce(array_agg(distinct (l.day - r.day1 + 1)) filter (where l.pts > 0), '{}'::int[])
    from public.profiles p
    cross join r
    cross join lon
    left join led l on l.user_id = p.id
   where not public._series_is_demo(p.id)
     and not exists (select 1 from public.series_exclusions x
                      where x.user_id = p.id and (x.round_id is null or x.round_id = p_round))
   group by p.id, p.show_on_leaderboard, r.day1, lon.today;
$$;

-- ── 5. Results ───────────────────────────────────────────────────────────────

create table if not exists public.series_results (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references public.series_rounds(id) on delete cascade,
  kind         text not null check (kind in ('place', 'draw', 'city')),
  -- 1st, 2nd … within its kind (Draw winner 1, 2, 3 …)
  place        int not null check (place >= 1),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  prize_id     uuid references public.series_prizes(id) on delete set null,
  points       int not null default 0,
  city         text,
  status       text not null default 'provisional' check (status in ('provisional', 'confirmed', 'void')),
  void_reason  text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  announced_at timestamptz
);
create unique index if not exists series_results_slot on public.series_results (round_id, kind, place) where status <> 'void';
create unique index if not exists series_results_once on public.series_results (round_id, kind, user_id) where status <> 'void';

alter table public.series_results enable row level security;
drop policy if exists series_results_admin_read on public.series_results;
create policy series_results_admin_read on public.series_results
  for select to authenticated using ((select public.is_admin()));
-- Writes only through the functions below.

-- The round's top city: highest average across its real members, among cities
-- with enough of them. Pacers never count (they aren't in _series_points).
create or replace function public._series_top_city(p_round uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select mc.city
    from public._series_member_cities(p_round) mc
    join public._series_points(p_round) p on p.user_id = mc.user_id and p.listed
   group by mc.city
  having count(*) >= (select city_min_members from public.series_rounds where id = p_round)
   order by avg(p.points) desc, count(*) desc, mc.city
   limit 1;
$$;

-- Preview (p_preview = true, the default) shows who would win the places,
-- how many are in The Draw and the top city, without writing anything.
-- Settling (p_preview = false) replaces any provisional results with fresh
-- ones: places by points, then The Draw and the top city's winners drawn at
-- random. Nothing is final until admin_series_confirm.
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
  v_cityn  := coalesce((select winners from public.series_prizes where round_id = v_round.id and kind = 'city'), 5);
  v_city   := public._series_top_city(v_round.id);

  create temp table if not exists _series_settle (
    user_id uuid, points int, days_logged int, rank int, city text
  ) on commit drop;
  delete from _series_settle;
  insert into _series_settle
  select p.user_id, p.points, cardinality(p.days),
         row_number() over (order by p.points desc, p.user_id)::int,
         mc.city
    from public._series_points(v_round.id) p
    left join public._series_member_cities(v_round.id) mc on mc.user_id = p.user_id
   where p.listed and p.points > 0;

  if not p_preview then
    delete from public.series_results where round_id = v_round.id and status = 'provisional';

    insert into public.series_results (round_id, kind, place, user_id, prize_id, points, city, created_by)
    select v_round.id, 'place', s.rank, s.user_id,
           (select id from public.series_prizes pr where pr.round_id = v_round.id and pr.kind = 'place' and pr.place = s.rank),
           s.points, s.city, v_uid
      from _series_settle s
     where s.rank <= v_places;

    insert into public.series_results (round_id, kind, place, user_id, prize_id, points, city, created_by)
    select v_round.id, 'draw', row_number() over (order by d.r)::int, d.user_id,
           (select id from public.series_prizes pr where pr.round_id = v_round.id and pr.kind = 'draw'),
           d.points, d.city, v_uid
      from (select s.*, random() as r from _series_settle s where s.days_logged >= v_round.draw_days
             order by r limit v_draw) d;

    if v_city is not null then
      insert into public.series_results (round_id, kind, place, user_id, prize_id, points, city, created_by)
      select v_round.id, 'city', row_number() over (order by c.r)::int, c.user_id,
             (select id from public.series_prizes pr where pr.round_id = v_round.id and pr.kind = 'city'),
             c.points, c.city, v_uid
        from (select s.*, random() as r from _series_settle s where s.city = v_city
               order by r limit v_cityn) c;
    end if;
  end if;

  select jsonb_build_object(
    'round', v_round.slug,
    'preview', p_preview,
    'running', now() < v_round.ends_at,
    'places', coalesce((select jsonb_agg(jsonb_build_object(
                'place', s.rank, 'user_id', s.user_id, 'points', s.points,
                'name', coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member'),
                -- a tie with the next place: decide it before confirming
                'tied', exists (select 1 from _series_settle t where t.rank = s.rank + 1 and t.points = s.points))
                order by s.rank)
                from _series_settle s join public.profiles p on p.id = s.user_id
               where s.rank <= v_places), '[]'::jsonb),
    'draw', jsonb_build_object(
      'eligible', (select count(*) from _series_settle where days_logged >= v_round.draw_days),
      'winners', v_draw,
      'days_needed', v_round.draw_days),
    'city', jsonb_build_object(
      'name', v_city,
      'eligible', (select count(*) from _series_settle where city = v_city),
      'winners', v_cityn),
    'results', case when p_preview then null else (select count(*) from public.series_results
                                                     where round_id = v_round.id and status = 'provisional') end
  ) into v_out;
  return v_out;
end;
$$;

-- Void one result and fill the gap. Places: everyone below moves up one (with
-- that place's prize) and the next member down takes the last place. A Draw or
-- city win is drawn again from the same pool.
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

  with pool as (
    select p.user_id, p.points, cardinality(p.days) as days_logged, mc.city,
           row_number() over (order by p.points desc, p.user_id) as rank
      from public._series_points(v_round.id) p
      left join public._series_member_cities(v_round.id) mc on mc.user_id = p.user_id
     where p.listed and p.points > 0
  )
  select pool.* into v_new
    from pool
   where not exists (select 1 from public.series_results x
                      where x.round_id = v_round.id and x.kind = v_res.kind and x.user_id = pool.user_id
                        and (x.status <> 'void' or x.id = v_res.id))
     and case v_res.kind
           when 'place' then true
           when 'draw' then pool.days_logged >= v_round.draw_days
           else pool.city = v_res.city
         end
   order by case when v_res.kind = 'place' then pool.rank::double precision else random() end
   limit 1;

  if v_new.user_id is null then
    return jsonb_build_object('replaced', false);
  end if;

  insert into public.series_results (round_id, kind, place, user_id, prize_id, points, city, created_by)
  values (v_round.id, v_res.kind, v_slot, v_new.user_id, v_prize, v_new.points, v_new.city, v_uid);

  return jsonb_build_object('replaced', true, 'user_id', v_new.user_id, 'place', v_slot,
    'name', (select coalesce(nullif(trim(display_name), ''), username, 'POWR member') from public.profiles where id = v_new.user_id));
end;
$$;

create or replace function public.admin_series_confirm(p_slug text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.series_results r set status = 'confirmed', confirmed_at = now()
    from public.series_rounds sr
   where sr.slug = p_slug and r.round_id = sr.id and r.status = 'provisional';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Announced results show in the app (get_series_results). p_on = false hides them again.
create or replace function public.admin_series_announce(p_slug text, p_on boolean default true)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.series_rounds;
  v_n     int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_round from public.series_rounds where slug = p_slug;
  if v_round.id is null then
    raise exception 'no round called %', p_slug using errcode = 'P0001';
  end if;
  if p_on and exists (select 1 from public.series_results where round_id = v_round.id and status = 'provisional') then
    raise exception 'confirm the results before announcing them' using errcode = 'P0001';
  end if;
  update public.series_results set announced_at = case when p_on then now() end
   where round_id = v_round.id and status = 'confirmed';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 6. Admin reads ───────────────────────────────────────────────────────────

-- The whole board as admins see it: every row marked member or pacer, with
-- the member-only place alongside. p_search matches a name, username or POWR ID.
create or replace function public.admin_series_board(
  p_slug text, p_offset int default 0, p_limit int default 50,
  p_real_only boolean default false, p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
           coalesce(p.country_code, pc.country_code) as country,
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
$$;

-- Every city with members or pacers: real members, pacers, the real average
-- (what ranks it), and whether it has enough real members to rank.
create or replace function public.admin_series_cities(p_slug text)
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
  select * into v_round from public.series_rounds where slug = p_slug;
  if v_round.id is null then
    return null;
  end if;

  with f as materialized (
    select * from public._series_field(v_round.id) where listed
  ),
  mc as materialized (
    select * from public._series_member_cities(v_round.id)
  ),
  people as (
    select mc.city, false as pacer, f.points from f join mc on mc.user_id = f.user_id where not f.pacer
    union all
    select pc.city, true, f.points from f join public.series_pacers pc on pc.id = f.user_id where f.pacer and pc.city is not null
  ),
  c as (
    select city,
           count(*) filter (where not pacer)::int as members,
           count(*) filter (where not pacer and points > 0)::int as moving,
           count(*) filter (where pacer)::int as pacers,
           coalesce(round(avg(points) filter (where not pacer)), 0)::int as avg
      from people group by city
  )
  select jsonb_build_object(
    'min_members', v_round.city_min_members,
    'min_cities', v_round.city_min_cities,
    'open', (select count(*) from c where members >= v_round.city_min_members) >= v_round.city_min_cities,
    'top', public._series_top_city(v_round.id),
    'no_city', (select count(*) from f where not pacer and f.user_id not in (select user_id from mc)),
    'cities', coalesce((select jsonb_agg(jsonb_build_object(
                'city', c.city, 'members', c.members, 'moving', c.moving, 'pacers', c.pacers, 'avg', c.avg,
                'ranked', c.members >= v_round.city_min_members,
                'gyms', (select count(*) from public.partners pa where pa.category = 'gym' and pa.active and pa.city = c.city))
                order by (c.members >= v_round.city_min_members) desc, c.avg desc, c.members desc) from c), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- How the pacers stand: the seat sum, who's seated by kind, and the safety
-- margin (the highest pacer against the real #3).
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

  with f as materialized (
    select * from public._series_field(v_round.id) where listed
  )
  select jsonb_build_object(
    'target', v_round.pacer_target,
    'growth', v_round.pacer_growth,
    'day', v_day,
    'seats', greatest(0, v_round.pacer_target + v_round.pacer_growth * (v_day - 1) - (select count(*) from f where not pacer)),
    'members', (select count(*) from f where not pacer),
    'seated', (select count(*) from f where pacer),
    'pool', (select count(*) from public.series_pacers),
    'disabled', (select count(*) from public.series_pacers where disabled),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (
                 select pc.kind, count(*) as n from f join public.series_pacers pc on pc.id = f.user_id where f.pacer group by pc.kind) k),
                 '{}'::jsonb),
    'top_pacer', (select max(points) from f where pacer),
    'real_third', (select points from f where not pacer order by points desc offset 2 limit 1),
    'planned_days', (select count(*) from public.series_pacer_days where round_id = v_round.id)
  ) into v_out;
  return v_out;
end;
$$;

-- ── 7. Admin writes ──────────────────────────────────────────────────────────

create or replace function public.admin_series_exclude(p_slug text, p_user uuid, p_reason text, p_every_round boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round uuid;
  v_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not p_every_round then
    select id into v_round from public.series_rounds where slug = p_slug;
    if v_round is null then
      raise exception 'no round called %', p_slug using errcode = 'P0001';
    end if;
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no such member' using errcode = 'P0001';
  end if;
  insert into public.series_exclusions (round_id, user_id, reason, created_by)
  values (v_round, p_user, trim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_series_include(p_exclusion uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  delete from public.series_exclusions where id = p_exclusion;
end;
$$;

-- Set a member's city for a round by hand; null puts them back on their gym's.
create or replace function public.admin_series_set_city(p_slug text, p_user uuid, p_city text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round uuid;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select id into v_round from public.series_rounds where slug = p_slug;
  if v_round is null then
    raise exception 'no round called %', p_slug using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_city, '')), '') is null then
    delete from public.series_cities where round_id = v_round and user_id = p_user;
    return;
  end if;
  insert into public.series_cities (round_id, user_id, city, source)
  values (v_round, p_user, trim(p_city), 'admin')
  on conflict (round_id, user_id) do update set city = excluded.city, source = 'admin', set_at = now();
end;
$$;

-- ── 8. The winners, for the app ──────────────────────────────────────────────
-- The latest finished round with announced results (or the named one).

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
                 'points', x.points, 'city', x.city, 'you', x.user_id = v_uid,
                 'prize', pr.name, 'sponsor', pr.sponsor, 'image_url', pr.image_url)
                 order by case x.kind when 'place' then 0 when 'draw' then 1 else 2 end, x.place)
                 from public.series_results x
                 join public.profiles p on p.id = x.user_id
                 left join public.series_prizes pr on pr.id = x.prize_id
                where x.round_id = v_round.id and x.status = 'confirmed' and x.announced_at is not null), '[]'::jsonb)
  );
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on function public._series_top_city(uuid) from public, anon, authenticated;
grant execute on function public._series_top_city(uuid) to service_role;

revoke all on function public.admin_series_settle(text, boolean, boolean) from public, anon;
revoke all on function public.admin_series_redraw(uuid, text) from public, anon;
revoke all on function public.admin_series_confirm(text) from public, anon;
revoke all on function public.admin_series_announce(text, boolean) from public, anon;
revoke all on function public.admin_series_board(text, int, int, boolean, text) from public, anon;
revoke all on function public.admin_series_cities(text) from public, anon;
revoke all on function public.admin_series_pacers(text) from public, anon;
revoke all on function public.admin_series_exclude(text, uuid, text, boolean) from public, anon;
revoke all on function public.admin_series_include(uuid) from public, anon;
revoke all on function public.admin_series_set_city(text, uuid, text) from public, anon;
revoke all on function public.get_series_results(text) from public, anon;
grant execute on function public.admin_series_settle(text, boolean, boolean) to authenticated;
grant execute on function public.admin_series_redraw(uuid, text) to authenticated;
grant execute on function public.admin_series_confirm(text) to authenticated;
grant execute on function public.admin_series_announce(text, boolean) to authenticated;
grant execute on function public.admin_series_board(text, int, int, boolean, text) to authenticated;
grant execute on function public.admin_series_cities(text) to authenticated;
grant execute on function public.admin_series_pacers(text) to authenticated;
grant execute on function public.admin_series_exclude(text, uuid, text, boolean) to authenticated;
grant execute on function public.admin_series_include(uuid) to authenticated;
grant execute on function public.admin_series_set_city(text, uuid, text) to authenticated;
grant execute on function public.get_series_results(text) to authenticated;
