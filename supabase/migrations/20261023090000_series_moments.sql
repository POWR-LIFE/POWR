-- The round's moments, set per round in /admin/series. Applies after
-- 20261022180000_series_seasons.sql.
--
-- A moment is a window inside a round that changes the game:
--   gun          the round opens (an announcement, nothing else)
--   double_down  chosen activities count ×n for the window
--   event_night  sessions verified at one venue count ×n
--   power_hour   every session counts ×n for the window
--   all_in       ×n for everyone outside the top N when it starts
--   blind        every rank hidden for the window ("passed you" pushes pause)
-- Boosts change SERIES points only, never the POWR points people spend, and
-- never stack: a session takes the highest boost it qualifies for, at most ×2.
-- A secret moment shows as a sealed card until it starts. A moment can push
-- everyone the Series is on for when it starts (series_moment, admin switch).
--
--   1. series_moments + guard
--   2. _series_points applies the boosts
--   3. get_series_moments(slug)   for the app; secret ones masked until they start
--   4. series_dispatch_pushes     moment pushes; no "passed you" in Blind Mode
--   5. the series_moment push type (off until switched on in Notifications)

-- ── 1. Moments ───────────────────────────────────────────────────────────────

create table if not exists public.series_moments (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.series_rounds(id) on delete cascade,
  kind        text not null check (kind in ('gun', 'double_down', 'event_night', 'power_hour', 'all_in', 'blind')),
  name        text not null check (length(trim(name)) between 2 and 40),
  line        text check (line is null or length(line) <= 120),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  -- ×n on Series points for sessions started in the window (1 for gun and blind).
  multiplier  numeric(3, 2) not null default 1 check (multiplier between 1 and 2),
  -- double_down: the activities that count (null = all).
  activities  text[],
  -- event_night: the venue a session has to be verified at.
  partner_id  uuid references public.partners(id) on delete set null,
  -- all_in: everyone outside this place when it starts gets the boost.
  top_n       int check (top_n is null or top_n between 1 and 1000),
  -- Never shown before it starts.
  secret      boolean not null default false,
  -- Push everyone the Series is on for when it starts.
  push        boolean not null default true,
  pushed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists series_moments_round on public.series_moments (round_id, starts_at);

alter table public.series_moments enable row level security;
drop policy if exists series_moments_admin on public.series_moments;
create policy series_moments_admin on public.series_moments
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- Members read them through get_series_moments (secret ones masked).

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
  if new.kind in ('gun', 'blind') then
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

drop trigger if exists series_moments_guard on public.series_moments;
create trigger series_moments_guard
  before insert or update on public.series_moments
  for each row execute function public._series_moments_guard();

-- ── 2. Series points with the boosts ─────────────────────────────────────────

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
  ),
  lon as (select (now() at time zone 'Europe/London')::date as today)
  select p.id,
         coalesce(p.show_on_leaderboard, true),
         coalesce(sum(l.spts) filter (where l.counts), 0)::int,
         coalesce(sum(l.spts) filter (where l.counts and l.day < lon.today), 0)::int,
         coalesce(sum(l.spts) filter (where l.counts and l.day = lon.today), 0)::int,
         coalesce(array_agg(distinct (l.day - r.day1 + 1)) filter (where l.pts > 0), '{}'::int[])
    from public.profiles p
    cross join r
    cross join lon
    left join scored l on l.user_id = p.id
   where not public._series_is_demo(p.id)
     and not exists (select 1 from public.series_exclusions x
                      where x.user_id = p.id and (x.round_id is null or x.round_id = p_round))
   group by p.id, p.show_on_leaderboard, r.day1, lon.today;
$$;

-- ── 3. For the app ───────────────────────────────────────────────────────────

create or replace function public.get_series_moments(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           case when m.secret and now() < m.starts_at
                then jsonb_build_object('id', m.id, 'kind', 'secret', 'name', null, 'line', null,
                                        'starts_at', null, 'ends_at', null, 'multiplier', null)
                else jsonb_build_object('id', m.id, 'kind', m.kind, 'name', m.name, 'line', m.line,
                                        'starts_at', m.starts_at, 'ends_at', m.ends_at, 'multiplier', m.multiplier)
           end order by m.starts_at), '[]'::jsonb)
    from public.series_moments m
    join public.series_rounds r on r.id = m.round_id
   where r.slug = p_slug and (r.published or public.is_admin());
$$;

-- ── 4. Pushes ────────────────────────────────────────────────────────────────

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
    v_targets := v_targets || coalesce((
      select jsonb_agg(jsonb_build_object(
               'target_user_id', p.id, 'type', 'series_moment',
               'payload', jsonb_build_object('title', m.name, 'body', coalesce(m.line, ''), 'kind', m.kind,
                                             'moment_id', m.id, 'series', v_series)))
        from public.profiles p
       where public._series_enabled_for(p.id) and not public._series_is_demo(p.id)), '[]'::jsonb);
  end loop;

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
                            'moments', v_moments, 'cities_locked', v_locked, 'dry_run', p_dry_run);
end;
$$;

-- ── 5. The moment push type ──────────────────────────────────────────────────

insert into public.notification_config (type, category, description, class, daily_cap, enabled) values
  ('series_moment', 'social',
   'Series: a round''s moment starts (Double Down, Power Hour, Blind Mode …): its name and line, once, to everyone the Series is on for. Each moment has its own push switch in /admin/series.',
   'social', 2, false)
on conflict (type) do nothing;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261023090000', 'series_moments')
on conflict (version) do nothing;

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on function public.get_series_moments(text) from public, anon;
grant execute on function public.get_series_moments(text) to authenticated;
