-- The Autumn Series: pacers and cities. Applies after 20261020150000_autumn_series.sql.
--
-- Pacers fill the board until real members do. They race like members (names,
-- flags, a home city, their own pace day to day) but they are not accounts:
-- they live in series_pacers, never in auth.users or profiles, so no push,
-- email, admin user count, gym portal or friend list can ever reach one.
--
-- The rules that keep them out of every prize, enforced here and nowhere else:
--   * a pacer's points are capped below the real #3 (a different fraction for
--     each pacer, 35–97%, so the ones held back don't bunch) and a tie always goes to the real member,
--     so places 1–3 are always real people;
--   * they have no sessions, so they are never in The Draw, a title, a gym's
--     crown or a duel;
--   * a city's average (its rank, and the Top city prize) is real members' only.
-- admin_series_round_stats reports real members and pacers separately.
--
-- How many: a round's board holds pacer_target people on day 1 and grows by
-- pacer_growth a day. Every real member takes a seat, so each one who joins
-- retires a pacer (the slowest first, so it only ever moves the foot of the
-- board). At pacer_target real members there are none left.
--
-- What's here:
--   1. series_rounds: published, pacer_target, pacer_growth, city_min_members, city_min_cities
--   2. _series_rand(key)              a stable 0–1 number from a key
--   3. series_pacers                  1,700 of them, seeded once
--   4. series_pacer_days              each pacer's sessions for each round, planned once
--   5. _series_field(round)           everyone on the board: members + pacers
--   6. partners.city                  read from the address, kept up to date
--   7. series_cities                  your city for a round, locked once set
--   8. get_series_board               now with pacers, flags and the My city game
--   9. series_dispatch_pushes         a pacer can pass you; cities lock every 15 min
--  10. admin_series_round_stats       real members and pacers, counted apart

-- ── 1. Round settings ────────────────────────────────────────────────────────

alter table public.series_rounds
  -- A round the app can see. New rounds start unpublished so admins can set
  -- them up (prizes, board size) before anyone sees them.
  add column if not exists published        boolean not null default false,
  add column if not exists pacer_target     int not null default 0,
  add column if not exists pacer_growth     int not null default 0,
  -- My city ranks a city once it has this many real members; the tab opens
  -- when this many cities rank.
  add column if not exists city_min_members int not null default 5,
  add column if not exists city_min_cities  int not null default 3;

update public.series_rounds set pacer_target = 1500, pacer_growth = 10, published = true
 where slug in ('autumn-01', 'autumn-02') and pacer_target = 0;

-- ── 2. A stable random number ────────────────────────────────────────────────

create or replace function public._series_rand(p_key text)
returns double precision
language sql
immutable
as $$
  select ('x' || lpad(substr(md5(p_key), 1, 8), 16, '0'))::bit(64)::bigint / 4294967296.0;
$$;

-- ── 3. The pacers ────────────────────────────────────────────────────────────

create table if not exists public.series_pacers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  country_code text,
  -- The city they count for on My city (null = no gym, like many members).
  city         text,
  kind         text not null check (kind in ('dormant', 'light', 'regular', 'committed', 'heavy')),
  -- When their sessions usually land.
  habit        text not null check (habit in ('morning', 'lunch', 'evening')),
  -- Share of days they move.
  active_share real not null,
  -- The most they may show, as a share of the real #3's points (0.35–0.97),
  -- spread so the ones held back don't bunch.
  cap          real not null,
  -- 1 retires first: the slowest.
  retire_order int not null unique,
  -- Taken off the board by an admin (a name that reads badly, a clash with a
  -- real person); the next pacer takes the seat.
  disabled     boolean not null default false,
  seed         int not null,
  created_at   timestamptz not null default now()
);
create unique index if not exists series_pacers_name on public.series_pacers (lower(name));
alter table public.series_pacers enable row level security;
-- No policies: only the definer functions below read it.

-- Country mix follows the members' (derived from timezone/GPS, so a Londoner
-- is GB whatever their name); a few have no flag, as members without a
-- timezone don't. Cities follow where the gyms are: mostly London.
insert into public.series_pacers (name, country_code, city, kind, habit, active_share, cap, retire_order, seed)
with lists (cc, firsts, lasts) as (values
  ('GB',
   array['Oliver','Harry','George','Jack','Charlie','Thomas','James','William','Alfie','Henry','Oscar','Leo','Archie','Joshua','Daniel',
         'Samuel','Max','Ethan','Lewis','Callum','Ryan','Jamie','Connor','Liam','Ben','Josh','Matt','Tom','Rob','Chris','Adam','Dan',
         'Luke','Jake','Sam','Joe','Alex','Nathan','Aaron','Kieran','Amelia','Olivia','Isla','Ava','Emily','Sophie','Grace','Lily',
         'Chloe','Ella','Mia','Ruby','Evie','Jessica','Lucy','Hannah','Holly','Megan','Charlotte','Georgia','Laura','Rachel','Katie',
         'Emma','Becky','Zoe','Abbie','Freya','Phoebe','Imogen','Rosie','Niamh','Eleanor','Harriet','Priya','Aisha','Zara','Amira',
         'Fatima','Anjali','Simran','Nadia','Yasmin','Leila','Arjun','Rohan','Imran','Bilal','Hamza','Omar','Yusuf','Ravi','Kiran',
         'Sanjay','Kwame','Tunde','Femi','Kofi','Chidi','Tayo','Kemi','Ama','Adaeze','Folake','Abena','Nia','Marcus','Jordan',
         'Tyrone','Dwayne','Shanice','Jade','Tasha','Keisha','Tomasz','Piotr','Kasia','Ola','Mateusz','Agnieszka','Wei','Mei','Jun',
         'Hana','Kenji','Minh','Linh'],
   array['Smith','Jones','Taylor','Brown','Williams','Wilson','Johnson','Davies','Robinson','Wright','Thompson','Evans','Walker',
         'White','Roberts','Green','Hall','Wood','Jackson','Clarke','Patel','Khan','Ahmed','Ali','Shah','Hussain','Begum','Chowdhury',
         'Iqbal','Rahman','Singh','Kaur','Sharma','Gupta','Mistry','Okafor','Adeyemi','Mensah','Owusu','Asante','Boateng','Okonkwo',
         'Bello','Adebayo','Campbell','Thomas','Lewis','Hughes','Edwards','Turner','Hill','Moore','Cooper','Ward','Morris','King',
         'Harris','Baker','Parker','Bennett','Cook','Price','Murphy','Kelly','O''Brien','Byrne','Walsh','Doyle','Gallagher','Reid',
         'Stewart','Murray','Fraser','Grant','MacDonald','Cameron','Ross','Nowak','Kowalczyk','Lewandowski','Zielinski','Chen',
         'Wong','Li','Zhang','Nguyen','Tran','Lee','Park','Kim','Silva','Santos','Costa','Ferreira','Rossi','Haddad','Mansour',
         'Nasser','Yilmaz','Demir','Georgiou','Ellis','Fisher','Marshall','Hunt','Knight','Mills','Barnes','Holmes','Lloyd',
         'Palmer','Webb','Spencer','Dixon','Rees','Mason','Fox','Hart','Burke','Quinn','Dunn','Pearce','Lowe','Bailey','Shaw',
         'Cole','Bishop','Rose','Lambert','Stone']),
  ('ES',
   array['Alejandro','Pablo','Javier','Carlos','Diego','Sergio','Álvaro','Marcos','Adrián','Hugo','Lucía','María','Paula','Laura',
         'Marta','Carmen','Sara','Elena','Irene','Claudia','Andrea','Nerea','Raúl','Iván','Rocío'],
   array['García','Fernández','González','Rodríguez','López','Martínez','Sánchez','Pérez','Gómez','Martín','Jiménez','Ruiz',
         'Hernández','Díaz','Moreno','Muñoz','Álvarez','Romero','Navarro','Torres','Domínguez','Vázquez','Ramos','Gil','Serrano']),
  ('IE',
   array['Seán','Ciarán','Cian','Oisín','Darragh','Conor','Eoin','Aoife','Siobhán','Niamh','Saoirse','Clodagh','Róisín','Orla','Fiadh'],
   array['Murphy','Kelly','O''Sullivan','Walsh','O''Connor','McCarthy','Ryan','O''Neill','Byrne','Doyle','Kennedy','Lynch','Quinn',
         'Brennan','Daly']),
  ('FR',
   array['Louis','Hugo','Lucas','Théo','Antoine','Julien','Maxime','Camille','Léa','Chloé','Manon','Inès','Juliette','Clément',
         'Mathilde','Élodie'],
   array['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre',
         'Michel','Garnier','Fontaine']),
  ('IT',
   array['Luca','Marco','Matteo','Alessandro','Giulia','Chiara','Francesca','Sofia','Lorenzo','Federica'],
   array['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci','Marino','Greco']),
  ('PT',
   array['João','Tiago','Rui','Inês','Beatriz','Mariana'],
   array['Silva','Santos','Ferreira','Pereira','Oliveira','Costa']),
  ('DE',
   array['Jonas','Lukas','Leon','Felix','Lena','Anna','Laura','Hannah'],
   array['Müller','Schmidt','Schneider','Fischer','Weber','Wagner']),
  ('NL',
   array['Daan','Sem','Lars','Sanne','Fleur','Lotte'],
   array['de Jong','Jansen','de Vries','van Dijk','Bakker','Visser'])
),
cand as (
  select i,
         public._series_rand('pacer:' || i || ':cc')    as r_cc,
         public._series_rand('pacer:' || i || ':first') as r_f,
         public._series_rand('pacer:' || i || ':last')  as r_l,
         public._series_rand('pacer:' || i || ':fmt')   as r_fmt,
         public._series_rand('pacer:' || i || ':kind')  as r_kind,
         public._series_rand('pacer:' || i || ':share') as r_share,
         public._series_rand('pacer:' || i || ':habit') as r_habit,
         public._series_rand('pacer:' || i || ':city')  as r_city,
         public._series_rand('pacer:' || i || ':cap')   as r_cap
    from generate_series(1, 2600) i
),
flagged as (
  select c.*,
         case when r_cc < 0.80 then 'GB' when r_cc < 0.85 then 'ES' when r_cc < 0.87 then 'IE' when r_cc < 0.885 then 'FR'
              when r_cc < 0.90 then 'US' when r_cc < 0.91 then 'IT' when r_cc < 0.92 then 'AU' when r_cc < 0.925 then 'PT'
              when r_cc < 0.93 then 'DE' when r_cc < 0.935 then 'NL' end as country
    from cand c
),
named as (
  select f.*,
         l.firsts[1 + floor(f.r_f * cardinality(l.firsts))::int] as first,
         l.lasts[1 + floor(f.r_l * cardinality(l.lasts))::int]  as last
    from flagged f
    join lists l on l.cc = case when f.country in ('ES', 'IE', 'FR', 'IT', 'PT', 'DE', 'NL') then f.country else 'GB' end
),
styled as (
  -- Most members show a full name; some an initial; a few only have a username.
  select n.*,
         case when r_fmt < 0.80 then first || ' ' || last
              when r_fmt < 0.94 then first || ' ' || left(last, 1) || '.'
              when r_fmt < 0.97 then lower(first) || '.' || lower(left(regexp_replace(last, '[^A-Za-z]', '', 'g'), 1))
                                     || (10 + floor(r_l * 89))::int::text
              else lower(first) || '_' || (array['runs', 'fit', 'moves', 'lifts', 'walks'])[1 + floor(r_f * 5)::int]
         end as name
    from named n
),
uniq as (
  select s.*, row_number() over (partition by lower(s.name) order by s.i) as dup from styled s
),
kept as (
  select u.*, row_number() over (order by u.i) as n from uniq u where u.dup = 1
),
traits as (
  select k.*,
         case when r_kind < 0.45 then 'dormant' when r_kind < 0.70 then 'light' when r_kind < 0.88 then 'regular'
              when r_kind < 0.97 then 'committed' else 'heavy' end as kind
    from kept k
   where k.n <= 1700
),
paced as (
  select t.*,
         case t.kind when 'dormant' then 0.02 + 0.08 * r_share when 'light' then 0.12 + 0.23 * r_share
                     when 'regular' then 0.35 + 0.30 * r_share when 'committed' then 0.60 + 0.25 * r_share
                     else 0.80 + 0.15 * r_share end as share,
         case t.kind when 'dormant' then 3 when 'light' then 5 when 'regular' then 10 when 'committed' then 14 else 18 end as day_pts
    from traits t
)
select name,
       country,
       case when country = 'GB' or country is null then
         case when r_city < 0.72 then 'London' when r_city < 0.77 then 'Manchester' when r_city < 0.80 then 'Birmingham'
              when r_city < 0.83 then 'Bristol' when r_city < 0.855 then 'Leeds' when r_city < 0.875 then 'Brighton'
              when r_city < 0.895 then 'Glasgow' when r_city < 0.915 then 'Edinburgh' when r_city < 0.93 then 'Liverpool'
              when r_city < 0.945 then 'Nottingham' when r_city < 0.955 then 'Sheffield' when r_city < 0.965 then 'Cardiff'
              when r_city < 0.975 then 'Newcastle' end
       end,
       kind,
       case when r_habit < 0.35 then 'morning' when r_habit < 0.50 then 'lunch' else 'evening' end,
       share,
       0.35 + 0.62 * r_cap,
       row_number() over (order by share * day_pts, i)::int,
       i
  from paced
 where not exists (select 1 from public.series_pacers);

-- ── 4. Each pacer's sessions, planned once per round ─────────────────────────
-- One row per day a pacer moves: the points that day and the London minute
-- they land. The board adds up the days that have landed by now.

create table if not exists public.series_pacer_days (
  round_id uuid not null references public.series_rounds(id) on delete cascade,
  pacer_id uuid not null references public.series_pacers(id) on delete cascade,
  -- 1 = the round's first day
  day      int not null,
  pts      int not null,
  at_min   int not null check (at_min between 0 and 1439),
  primary key (round_id, pacer_id, day)
);
alter table public.series_pacer_days enable row level security;

-- A day's points, made the way POWR pays: a walk is one step tier (1–5), a run
-- or ride 5–10, a gym visit 15 or 20 (with the 40-minute upgrade).
create or replace function public._series_plan_pacers(p_round uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_n    int;
begin
  select (ends_at at time zone 'Europe/London')::date - (starts_at at time zone 'Europe/London')::date
    into v_days from public.series_rounds where id = p_round;
  if v_days is null then
    return 0;
  end if;

  delete from public.series_pacer_days where round_id = p_round;

  insert into public.series_pacer_days (round_id, pacer_id, day, pts, at_min)
  select p_round, x.id, x.day,
         greatest(1, x.walk + x.run + x.gym),
         least(1439, case x.slot when 'morning' then 360 + floor(x.r_time * 180)
                                 when 'lunch'   then 720 + floor(x.r_time * 120)
                                 else 1020 + floor(x.r_time * 240) end)::int
    from (
      select pc.id, d.day, h.r_time,
             -- Most days follow the habit; some don't.
             case when h.r_slot < 0.80 then pc.habit when h.r_slot < 0.90 then 'morning' else 'evening' end as slot,
             case when h.r_walk < case pc.kind when 'dormant' then 1.0 when 'light' then 0.9 else 0.72 end
                  then 1 + floor(h.r_size * 5)::int else 0 end as walk,
             case when (pc.kind = 'light' and h.r_kind < 0.25)
                    or (pc.kind = 'regular' and h.r_kind < 0.45)
                    or (pc.kind = 'committed' and h.r_kind < 0.40)
                    or (pc.kind = 'heavy' and (h.r_kind < 0.35 or h.r_kind >= 0.90))
                  then 5 + floor(h.r_size2 * 6)::int else 0 end as run,
             case when (pc.kind = 'regular' and h.r_kind >= 0.45 and h.r_kind < 0.70)
                    or (pc.kind = 'committed' and h.r_kind >= 0.40 and h.r_kind < 0.80)
                    or (pc.kind = 'heavy' and h.r_kind >= 0.35)
                  then case when h.r_size2 < 0.5 then 15 else 20 end else 0 end as gym
        from public.series_pacers pc
        cross join generate_series(1, v_days) d(day)
        cross join lateral (
          select public._series_rand(pc.seed || ':' || p_round || ':' || d.day || ':on')    as r_on,
                 public._series_rand(pc.seed || ':' || p_round || ':' || d.day || ':walk')  as r_walk,
                 public._series_rand(pc.seed || ':' || p_round || ':' || d.day || ':kind')  as r_kind,
                 public._series_rand(pc.seed || ':' || p_round || ':' || d.day || ':size')  as r_size,
                 public._series_rand(pc.seed || ':' || p_round || ':' || d.day || ':size2') as r_size2,
                 public._series_rand(pc.seed || ':' || p_round || ':' || d.day || ':slot')  as r_slot,
                 public._series_rand(pc.seed || ':' || p_round || ':' || d.day || ':time')  as r_time
        ) h
       where h.r_on < pc.active_share
    ) x;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public._series_plan_pacers_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._series_plan_pacers(new.id);
  return new;
end;
$$;

drop trigger if exists series_rounds_plan_pacers on public.series_rounds;
create trigger series_rounds_plan_pacers
  after insert on public.series_rounds
  for each row execute function public._series_plan_pacers_on_insert();

select public._series_plan_pacers(id) from public.series_rounds
 where not exists (select 1 from public.series_pacer_days d where d.round_id = series_rounds.id);

-- ── 5. Everyone on the board ─────────────────────────────────────────────────
-- _series_points (real members) plus the pacers who hold a seat right now,
-- capped below the real #3. Callers rank with `order by points desc, pacer,
-- user_id` so a tie goes to the member.

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
    select sr.pacer_target, sr.pacer_growth,
           (sr.starts_at at time zone 'Europe/London')::date as day1,
           (sr.ends_at at time zone 'Europe/London')::date - (sr.starts_at at time zone 'Europe/London')::date as ndays
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
  third as (
    select coalesce((select x.points from people x where x.listed order by x.points desc offset 2 limit 1), 0) as pts,
           coalesce((select x.points_mid from people x where x.listed order by x.points_mid desc offset 2 limit 1), 0) as mid
  ),
  seats as (
    select greatest(0, r.pacer_target
                       + r.pacer_growth * (greatest(1, least(r.ndays, clock.d - r.day1 + 1)) - 1)
                       - (select count(*) from people x where x.listed))::int as k
      from r, clock
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
           least(run.pts, greatest(0, least(floor(third.pts * run.cap)::int, third.pts - 1))) as pts,
           least(run.mid, greatest(0, least(floor(third.mid * run.cap)::int, third.mid - 1))) as mid
      from run, third
  )
  select x.user_id, false, x.listed, x.points, x.points_mid, x.today, x.days from people x
  union all
  select c.id, true, true, c.pts, c.mid, greatest(0, c.pts - c.mid), '{}'::int[] from capped c;
$$;

-- ── 6. A gym's city ──────────────────────────────────────────────────────────
-- From the address: the postal town in front of a UK postcode, with every
-- London postcode and Greater London postal town counted as London; else the
-- town after a 4–5 digit postcode (most of Europe). Admins can overwrite it.

alter table public.partners add column if not exists city text;

create or replace function public._city_of_address(p_address text)
returns text
language plpgsql
immutable
as $$
declare
  m    text[];
  town text;
  area text;
begin
  if p_address is null then
    return null;
  end if;
  m := regexp_match(p_address, '(?:^|,)\s*([^,]*?)\s*\m([A-Z]{1,2})[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}\M');
  if m is not null then
    town := nullif(trim(m[1]), '');
    area := m[2];
    if area in ('E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC') then
      return 'London';
    end if;
    if town is null then
      return null;
    end if;
    if lower(town) in ('barking', 'barnet', 'beckenham', 'bexley', 'bexleyheath', 'brentford', 'bromley', 'carshalton',
                       'chislehurst', 'coulsdon', 'croydon', 'dagenham', 'edgware', 'enfield', 'erith', 'feltham',
                       'greenford', 'hampton', 'harrow', 'hayes', 'hornchurch', 'hounslow', 'ilford', 'isleworth',
                       'kingston upon thames', 'mitcham', 'morden', 'new malden', 'northolt', 'northwood', 'orpington',
                       'pinner', 'purley', 'rainham', 'richmond', 'romford', 'ruislip', 'sidcup', 'south croydon',
                       'southall', 'stanmore', 'surbiton', 'sutton', 'teddington', 'thornton heath', 'twickenham',
                       'upminster', 'uxbridge', 'wallington', 'welling', 'wembley', 'west drayton', 'west wickham',
                       'woodford green') then
      return 'London';
    end if;
    if area = 'M' or lower(town) = 'salford' then
      return 'Manchester';
    end if;
    if lower(town) = 'hove' then
      return 'Brighton';
    end if;
    if lower(town) in ('newcastle upon tyne', 'gateshead') then
      return 'Newcastle';
    end if;
    return initcap(town);
  end if;
  m := regexp_match(p_address, ',\s*[0-9]{4,5}\s+([^,0-9]+?)\s*(?:,|$)');
  if m is not null then
    return nullif(trim(m[1]), '');
  end if;
  return null;
end;
$$;

-- Fill the city from the address unless the same write sets it by hand.
-- _city_of_address stays executable by everyone: the gym portal edits addresses
-- as the signed-in gym, and this runs as them.
create or replace function public._partners_city()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.city is null then
      new.city := public._city_of_address(new.address);
    end if;
  elsif new.address is distinct from old.address and new.city is not distinct from old.city then
    new.city := public._city_of_address(new.address);
  end if;
  return new;
end;
$$;

drop trigger if exists partners_city on public.partners;
create trigger partners_city
  before insert or update of address, city on public.partners
  for each row execute function public._partners_city();

update public.partners set city = public._city_of_address(address)
 where city is null and address is not null;

-- ── 7. Your city for a round ─────────────────────────────────────────────────
-- It comes from your gym. Without one you pick it once. Either way it locks for
-- the round (the 15-minute job locks gym cities), so nobody can hop to the
-- leading city before the Top city prize.

create table if not exists public.series_cities (
  round_id uuid not null references public.series_rounds(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  city     text not null,
  -- gym = from your gym; picked = you chose; admin = set by an admin.
  source   text not null check (source in ('gym', 'picked', 'admin')),
  set_at   timestamptz not null default now(),
  primary key (round_id, user_id)
);
alter table public.series_cities enable row level security;
drop policy if exists series_cities_own on public.series_cities;
create policy series_cities_own on public.series_cities
  for select to authenticated using ((select auth.uid()) = user_id);
-- Writes only through series_pick_city / _series_lock_cities.

-- Each member's city this round: the locked one, else their gym's.
create or replace function public._series_member_cities(p_round uuid)
returns table (user_id uuid, city text, source text, locked boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         coalesce(sc.city, pa.city),
         coalesce(sc.source, 'gym'),
         sc.user_id is not null
    from public.profiles p
    left join public.series_cities sc on sc.round_id = p_round and sc.user_id = p.id
    left join public.partners pa on pa.id = p.preferred_gym_id
   where coalesce(sc.city, pa.city) is not null
     and not public._series_is_demo(p.id);
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
    from public.profiles p
    join public.partners pa on pa.id = p.preferred_gym_id
   where pa.city is not null
     and not public._series_is_demo(p.id)
  on conflict (round_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Cities you can pick: any city with a gym on POWR.
create or replace function public._series_city_options()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(city order by n desc, city), '{}')
    from (select city, count(*) as n
            from public.partners
           where category = 'gym' and active and city is not null
           group by city) c;
$$;

create or replace function public.series_pick_city(p_city text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_round public.series_rounds;
  v_city  text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- The round on now, else the next one.
  select * into v_round from public.series_rounds where published and now() < ends_at order by starts_at limit 1;
  if v_round.id is null then
    raise exception 'no round to pick a city for' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.series_cities where round_id = v_round.id and user_id = v_uid) then
    raise exception 'your city is locked for this round' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p join public.partners pa on pa.id = p.preferred_gym_id
              where p.id = v_uid and pa.city is not null) then
    raise exception 'your gym sets your city' using errcode = 'P0001';
  end if;
  select c into v_city from unnest(public._series_city_options()) c where lower(c) = lower(trim(p_city)) limit 1;
  if v_city is null then
    raise exception 'unknown city' using errcode = 'P0001';
  end if;
  insert into public.series_cities (round_id, user_id, city, source) values (v_round.id, v_uid, v_city, 'picked');
  return v_city;
end;
$$;

-- ── 8. The board ─────────────────────────────────────────────────────────────
-- As before (top 3, the one above you, you, two below; rival; the crown; duels)
-- with pacers in the race, a flag per row, and the My city game:
--   city.cities = ranked cities (enough real members), by average points;
--   members counts everyone in the city, the average is real members' only.

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
        where n.rank = case when me.rank = 1 then 2 else me.rank - 1 end)
    ) x
    order by x.pref limit 1
  ),
  shown as (
    select n.* from named n, me
     where n.rank <= 3 or n.rank between me.rank - 1 and me.rank + 2
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

-- ── 9. Pushes: a pacer can pass you ──────────────────────────────────────────
-- Series pushes only reach members the Series is switched on for (the
-- series_live switch in admin Config: off, testers or on).

create or replace function public._series_enabled_for(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce((select value from public.system_config where key = 'series_live'), 'off') as live,
           coalesce((select value from public.system_config where key = 'series_testers'), '') as testers
  )
  select case cfg.live
           when 'on' then true
           when 'testers' then p_uid::text = any (string_to_array(replace(cfg.testers, ' ', ''), ','))
                            or exists (select 1 from public.admin_roles a where a.user_id = p_uid)
           else false
         end
    from cfg;
$$;

-- For the app: is the Series on for me?
create or replace function public.series_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public._series_enabled_for(auth.uid());
$$;

insert into public.system_config (key, value, description)
values
  ('series_live', 'off',
   'The Autumn Series in the app: off, testers (admins + series_testers) or on. Pushes follow it too.'),
  ('series_testers', '',
   'Comma-separated POWR user ids who see the Series while series_live is testers.')
on conflict (key) do nothing;

-- Same two pushes, now ranked over the whole board. Pacers are snapshotted too
-- (so "passed you" sees them move), which means the snapshot can't point at
-- profiles any more. Pushes still only go to members.

alter table public.series_rank_snapshots drop constraint if exists series_rank_snapshots_user_id_fkey;

create or replace function public.series_dispatch_pushes(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round   public.series_rounds;
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
        'payload', jsonb_build_object('name', r.by_name, 'rank', r.rank, 'gap', r.by_points - r.points));
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
          'friend', r.rv_friend));
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

-- ── 10. How a round is doing (admin): real members and pacers apart ──────────

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

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on function public._series_rand(text) from public, anon, authenticated;
revoke all on function public._series_plan_pacers(uuid) from public, anon, authenticated;
revoke all on function public._series_plan_pacers_on_insert() from public, anon, authenticated;
revoke all on function public._series_field(uuid) from public, anon, authenticated;
revoke all on function public._series_member_cities(uuid) from public, anon, authenticated;
revoke all on function public._series_lock_cities(uuid) from public, anon, authenticated;
revoke all on function public._series_city_options() from public, anon, authenticated;
revoke all on function public._series_enabled_for(uuid) from public, anon, authenticated;
grant execute on function public._series_enabled_for(uuid) to service_role;
revoke all on function public.series_enabled() from public, anon;
grant execute on function public.series_enabled() to authenticated;
grant execute on function public._series_rand(text) to service_role;
grant execute on function public._series_plan_pacers(uuid) to service_role;
grant execute on function public._series_field(uuid) to service_role;
grant execute on function public._series_member_cities(uuid) to service_role;
grant execute on function public._series_lock_cities(uuid) to service_role;
grant execute on function public._series_city_options() to service_role;

revoke all on function public.series_pick_city(text) from public, anon;
grant execute on function public.series_pick_city(text) to authenticated;
