-- The Series runs in seasons. Applies after 20261022150000_series_admin.sql.
--
-- A season (Autumn, Winter, Spring, Summer) holds the year's monthly rounds and
-- decides what the app wears: its name, its look (colours and mark), its Nº and
-- code. Seasons run by quarter, the way Sorine's lookbook numbers them:
--   Autumn  Oct–Dec   Nº 01 — AW26
--   Winter  Jan–Mar   Nº 02 — AW26
--   Spring  Apr–Jun   Nº 03 — SS27
--   Summer  Jul–Sep   Nº 04 — SS27
-- and every season can be edited in /admin/series.
--
--   1. series_seasons, and series_rounds.season_id (Round 01 + 02 → Autumn)
--   2. guards: no overlapping seasons; a round sits inside its season; a round
--      can only be published in a published season; unpublishing a season
--      unpublishes its rounds. Pacers are planned when a round is published,
--      not when it's drafted (a year of drafts would plan thousands of rows
--      for nothing).
--   3. admin_series_plan(until)   drafts every season and monthly round up to a
--                                 date, so the year is set up in one go
--   4. series_status()            for the app: is the Series on for me, and
--                                 which season is current
--   5. the pushes name the season ("… in the Winter Series")
--   6. the city picker lists cities with the most members first
--   7. records the Series migrations in schema_migrations (they were applied
--      by hand)

-- ── 1. Seasons ───────────────────────────────────────────────────────────────

create table if not exists public.series_seasons (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  -- What the app calls it: "Autumn Series".
  name       text not null check (length(trim(name)) between 3 and 60),
  -- Which colourway and mark the app wears.
  look       text not null check (look in ('autumn', 'winter', 'spring', 'summer')),
  -- Nº 01, Nº 02 … and the code beside it: AW26, SS27.
  number     int not null check (number between 1 and 999),
  code       text check (code is null or length(code) <= 12),
  -- First and last day (London), inclusive.
  starts_on  date not null,
  ends_on    date not null,
  published  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

alter table public.series_seasons enable row level security;
drop policy if exists series_seasons_read on public.series_seasons;
create policy series_seasons_read on public.series_seasons
  for select to authenticated using (published or (select public.is_admin()));
drop policy if exists series_seasons_admin on public.series_seasons;
create policy series_seasons_admin on public.series_seasons
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

alter table public.series_rounds
  add column if not exists season_id uuid references public.series_seasons(id) on delete restrict;

insert into public.series_seasons (slug, name, look, number, code, starts_on, ends_on, published)
values ('autumn-26', 'Autumn Series', 'autumn', 1, 'AW26', '2026-10-01', '2026-12-31', true)
on conflict (slug) do nothing;

update public.series_rounds r set season_id = s.id
  from public.series_seasons s
 where s.slug = 'autumn-26' and r.slug in ('autumn-01', 'autumn-02') and r.season_id is null;

-- ── 2. Guards ────────────────────────────────────────────────────────────────

create or replace function public._series_seasons_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_clash text;
begin
  select s.name into v_clash from public.series_seasons s
   where s.id <> new.id and daterange(s.starts_on, s.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')
   limit 1;
  if v_clash is not null then
    raise exception 'these dates overlap %', v_clash using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and exists (
       select 1 from public.series_rounds r
        where r.season_id = new.id
          and ((r.starts_at at time zone 'Europe/London')::date < new.starts_on
               or (r.ends_at at time zone 'Europe/London')::date - 1 > new.ends_on)) then
    raise exception 'a round in this season falls outside those dates: move it first' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists series_seasons_guard on public.series_seasons;
create trigger series_seasons_guard
  before insert or update on public.series_seasons
  for each row execute function public._series_seasons_guard();

-- Unpublish a season and its rounds go with it.
create or replace function public._series_seasons_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.published and not new.published then
    update public.series_rounds set published = false where season_id = new.id and published;
  end if;
  return new;
end;
$$;

drop trigger if exists series_seasons_cascade on public.series_seasons;
create trigger series_seasons_cascade
  after update of published on public.series_seasons
  for each row execute function public._series_seasons_cascade();

-- Rounds: the old guard plus the season's rules.
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

-- Pacers: plan a round when it goes live (published), or when a live round's
-- dates move. Drafts wait.
create or replace function public._series_plan_pacers_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.published then
    perform public._series_plan_pacers(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists series_rounds_plan_on_publish on public.series_rounds;
create trigger series_rounds_plan_on_publish
  after update of published on public.series_rounds
  for each row
  when (new.published and not old.published)
  execute function public._series_plan_pacers_on_insert();

-- ── 3. Plan ahead ────────────────────────────────────────────────────────────
-- Drafts every season and monthly round from the last one set up to p_until.
-- Seasons are quarters (Oct–Dec Autumn, Jan–Mar Winter, Apr–Jun Spring,
-- Jul–Sep Summer). Each month gets one round from day p_start_day for
-- p_days days, unless a round already sits in that month. New rounds copy the
-- latest round's settings (Draw days, board size, city gates). Everything is a
-- draft: nothing reaches the app until it's published.
create or replace function public.admin_series_plan(
  p_until date, p_days int default 15, p_start_day int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tpl     public.series_rounds;
  v_month   date;
  v_q       date;
  v_season  public.series_seasons;
  v_look    text;
  v_year    int;
  v_n       int;
  v_start   date;
  v_seasons int := 0;
  v_rounds  int := 0;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_days < 1 or p_days > 28 or p_start_day < 1 or p_start_day + p_days - 1 > 28 then
    raise exception 'a monthly round has to fit inside the month (start day + days ≤ 29)' using errcode = 'P0001';
  end if;
  if p_until > (now() at time zone 'Europe/London')::date + 731 then
    raise exception 'plan up to two years ahead at most' using errcode = 'P0001';
  end if;
  select * into v_tpl from public.series_rounds order by starts_at desc limit 1;

  -- From the month after the last round (or this month), to p_until.
  v_month := date_trunc('month', coalesce(
    (select max((ends_at at time zone 'Europe/London')::date) from public.series_rounds),
    (now() at time zone 'Europe/London')::date))::date;
  if exists (select 1 from public.series_rounds
              where date_trunc('month', (starts_at at time zone 'Europe/London')::date) = v_month) then
    v_month := (v_month + interval '1 month')::date;
  end if;

  while v_month <= p_until loop
    -- The quarter this month sits in, and its season.
    v_q := (date_trunc('quarter', v_month))::date;
    select * into v_season from public.series_seasons
     where v_month between starts_on and ends_on limit 1;
    if v_season.id is null then
      v_look := case extract(month from v_q)::int when 10 then 'autumn' when 1 then 'winter' when 4 then 'spring' else 'summer' end;
      v_year := extract(year from v_q)::int;
      insert into public.series_seasons (slug, name, look, number, code, starts_on, ends_on, published)
      values (
        v_look || '-' || right(v_year::text, 2),
        initcap(v_look) || ' Series',
        v_look,
        coalesce((select max(number) from public.series_seasons), 0) + 1,
        case when v_look in ('autumn', 'winter')
             then 'AW' || right((case when v_look = 'winter' then v_year - 1 else v_year end)::text, 2)
             else 'SS' || right(v_year::text, 2) end,
        v_q, (v_q + interval '3 months' - interval '1 day')::date, false)
      returning * into v_season;
      v_seasons := v_seasons + 1;
    end if;

    if not exists (select 1 from public.series_rounds
                    where date_trunc('month', (starts_at at time zone 'Europe/London')::date) = v_month) then
      v_start := v_month + (p_start_day - 1);
      v_n := coalesce((select count(*) from public.series_rounds where season_id = v_season.id), 0) + 1;
      insert into public.series_rounds (slug, name, season_id, starts_at, ends_at, draw_days,
                                        pacer_target, pacer_growth, city_min_members, city_min_cities, published)
      values (
        v_season.slug || '-r' || lpad(v_n::text, 2, '0'),
        'Round ' || lpad(v_n::text, 2, '0'),
        v_season.id,
        v_start::timestamp at time zone 'Europe/London',
        (v_start + p_days)::timestamp at time zone 'Europe/London',
        least(coalesce(v_tpl.draw_days, 10), p_days),
        coalesce(v_tpl.pacer_target, 1500), coalesce(v_tpl.pacer_growth, 10),
        coalesce(v_tpl.city_min_members, 5), coalesce(v_tpl.city_min_cities, 3),
        false);
      v_rounds := v_rounds + 1;
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;

  return jsonb_build_object('seasons', v_seasons, 'rounds', v_rounds);
end;
$$;

-- ── 4. For the app ───────────────────────────────────────────────────────────
-- Is the Series on for me, and which season is current: the one running today,
-- else the next published one, else the last. `round` is that season's round
-- on now (else its next, else its last), for the lockup's second line.
create or replace function public.series_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with today as (select (now() at time zone 'Europe/London')::date as d)
  select jsonb_build_object(
    'on', auth.uid() is not null and public._series_enabled_for(auth.uid()),
    'season', (
      select jsonb_build_object('slug', s.slug, 'name', s.name, 'look', s.look, 'number', s.number,
                                'code', s.code, 'starts_on', s.starts_on, 'ends_on', s.ends_on,
                                'round', (select r.name from public.series_rounds r
                                           where r.season_id = s.id and r.published
                                           order by (now() >= r.starts_at and now() < r.ends_at) desc,
                                                    (r.starts_at > now()) desc,
                                                    case when r.starts_at > now() then r.starts_at end asc,
                                                    r.ends_at desc
                                           limit 1))
        from public.series_seasons s, today
       where s.published
       order by (today.d between s.starts_on and s.ends_on) desc,
                (s.starts_on > today.d) desc,
                case when s.starts_on > today.d then s.starts_on end asc,
                s.ends_on desc
       limit 1))
  from today;
$$;

-- ── 5. Pushes name the season ────────────────────────────────────────────────

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
  v_n       int;
  v_on      text[];
  r         record;
begin
  select coalesce(array_agg(type), '{}') into v_on
    from public.notification_config
   where type in ('series_rival', 'series_passed') and enabled;

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

  -- Someone passed you since the last check.
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
         where x.rank < me.rank and sx.rank > sn.rank
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

  -- The 08:00 rival push, in each person's own timezone.
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
      left join st a on a.rank = case when me.rank = 1 then 2 else me.rank - 1 end
     where not me.pacer
       and me.points > 0
       and 'series_rival' = any (v_on)
       and public._series_enabled_for(me.user_id)
       and public._series_local_now(pr.timezone)::time >= '08:00'
       and public._series_local_now(pr.timezone)::time < '08:15'
       and coalesce(f.user_id, a.user_id) is not null
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
                           (select pc.name from public.series_pacers pc where pc.id = r.rv_id),
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
                            'cities_locked', v_locked, 'dry_run', p_dry_run);
end;
$$;

-- ── 6. Cities you can pick: most members first ───────────────────────────────

create or replace function public._series_city_options()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select city, count(*) as gyms from public.partners
     where category = 'gym' and active and city is not null group by city
  ),
  m as (
    select pa.city, count(*) as members
      from public.profiles p join public.partners pa on pa.id = p.preferred_gym_id
     where pa.city is not null group by pa.city
  )
  select coalesce(array_agg(g.city order by coalesce(m.members, 0) desc, g.gyms desc, g.city), '{}')
    from g left join m using (city);
$$;

-- ── 7. The record ────────────────────────────────────────────────────────────

insert into supabase_migrations.schema_migrations (version, name)
values ('20261020150000', 'autumn_series'),
       ('20261022120000', 'series_pacers_and_cities'),
       ('20261022150000', 'series_admin'),
       ('20261022180000', 'series_seasons')
on conflict (version) do nothing;

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on function public.admin_series_plan(date, int, int) from public, anon;
grant execute on function public.admin_series_plan(date, int, int) to authenticated;
revoke all on function public.series_status() from public, anon;
grant execute on function public.series_status() to authenticated;
