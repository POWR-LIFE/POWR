-- ── Honours ───────────────────────────────────────────────────────────────────
-- Seven things a member can earn by moving, shown as small line icons under
-- their name on the Series board (and anywhere else a name goes). Each is one
-- row per member per kind, with a tier that only ever goes up:
--
--   king      hold Nº 1 on the board at a day's close      gold only, counts days
--   on_fire   move every week                              best run of weeks in a row
--   power     move 5+ days a week                          weeks it happened
--   diamond   move every day of a round                    rounds it happened
--   wings     biggest climb up the board                   Level Up wins (series_results)
--   hive      bring friends into the squad                 friends who joined with your code and worked out
--   strength  most strength sessions in a round            rounds you topped (gym sessions)
--
-- Tiers: bronze / silver / gold at the thresholds in _honour_tier below. King
-- is gold the day it's earned. `award_honours()` runs on a cron just after
-- London midnight and is safe to run any number of times. Sessions count the
-- way the Series counts them (_series_ledger: verified, not flagged, not sleep,
-- not demo accounts).

create table if not exists public.honours (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('king', 'on_fire', 'power', 'diamond', 'wings', 'hive', 'strength')),
  tier       text not null check (tier in ('bronze', 'silver', 'gold')),
  -- What the tier is measured on (days, weeks, rounds, friends, wins).
  count      int  not null default 0 check (count >= 0),
  -- King: the last London day it was credited, so a day never counts twice.
  last_day   date,
  first_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.honours enable row level security;
-- Honours sit beside names on a public board, so any member can read any.
drop policy if exists honours_read on public.honours;
create policy honours_read on public.honours for select to authenticated using (true);
-- Nothing writes but award_honours (security definer).

-- The tier a count earns, per kind.
create or replace function public._honour_tier(p_kind text, p_count int)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'king'     then case when p_count >= 1 then 'gold' end
    when 'on_fire'  then case when p_count >= 12 then 'gold' when p_count >= 8 then 'silver' when p_count >= 4 then 'bronze' end
    when 'power'    then case when p_count >= 8  then 'gold' when p_count >= 4 then 'silver' when p_count >= 1 then 'bronze' end
    when 'diamond'  then case when p_count >= 3  then 'gold' when p_count >= 2 then 'silver' when p_count >= 1 then 'bronze' end
    when 'wings'    then case when p_count >= 3  then 'gold' when p_count >= 2 then 'silver' when p_count >= 1 then 'bronze' end
    when 'hive'     then case when p_count >= 5  then 'gold' when p_count >= 3 then 'silver' when p_count >= 1 then 'bronze' end
    when 'strength' then case when p_count >= 3  then 'gold' when p_count >= 2 then 'silver' when p_count >= 1 then 'bronze' end
  end
$$;

create or replace function public._honour_rank(p_tier text)
returns int
language sql
immutable
as $$ select case p_tier when 'gold' then 3 when 'silver' then 2 when 'bronze' then 1 else 0 end $$;

-- Write one member's count for a kind. The tier never drops; the count is the
-- best seen, so a streak that breaks keeps the honour it earned.
create or replace function public._honour_set(p_user uuid, p_kind text, p_count int, p_day date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text := public._honour_tier(p_kind, p_count);
begin
  if v_tier is null then return; end if;
  insert into public.honours (user_id, kind, tier, count, last_day)
  values (p_user, p_kind, v_tier, p_count, p_day)
  on conflict (user_id, kind) do update
    set count      = greatest(public.honours.count, excluded.count),
        tier       = case when public._honour_rank(excluded.tier) > public._honour_rank(public.honours.tier) then excluded.tier else public.honours.tier end,
        last_day   = coalesce(excluded.last_day, public.honours.last_day),
        updated_at = now()
   where public.honours.count <> greatest(public.honours.count, excluded.count)
      or public._honour_rank(excluded.tier) > public._honour_rank(public.honours.tier)
      or (excluded.last_day is not null and excluded.last_day is distinct from public.honours.last_day);
end;
$$;

-- Work out every honour from what's on record. Idempotent.
create or replace function public.award_honours()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
  v_from  timestamptz := (v_today - 364)::timestamp at time zone 'Europe/London';
  r record;
begin
  -- ── Weeks: On Fire (every week in a row) and Power (5+ days in a week) ─────
  -- The current week is still being lived, so only closed weeks count.
  create temp table t_weeks on commit drop as
    select l.user_id, date_trunc('week', l.day)::date as wk, count(distinct l.day)::int as days
      from public._series_ledger(v_from, now()) l
     where l.counts
       and date_trunc('week', l.day)::date < date_trunc('week', v_today)::date
     group by l.user_id, date_trunc('week', l.day);

  for r in
    with runs as (
      select user_id, wk,
             wk - (row_number() over (partition by user_id order by wk) * 7)::int as grp
        from t_weeks
    )
    select user_id, max(n) as best
      from (select user_id, grp, count(*)::int as n from runs group by user_id, grp) x
     group by user_id
  loop
    perform public._honour_set(r.user_id, 'on_fire', r.best);
  end loop;

  for r in select user_id, count(*)::int as n from t_weeks where days >= 5 group by user_id loop
    perform public._honour_set(r.user_id, 'power', r.n);
  end loop;

  -- ── Rounds that have ended: Diamond and Strength ───────────────────────────
  for r in
    select id, starts_at, ends_at,
           ((ends_at at time zone 'Europe/London')::date - (starts_at at time zone 'Europe/London')::date)::int as days
      from public.series_rounds
     where published and ends_at <= now()
  loop
    create temp table t_round on commit drop as
      select l.user_id,
             count(distinct l.day) filter (where l.counts)::int as active_days,
             count(*) filter (where l.counts and l.type = 'gym')::int as gym
        from public._series_ledger(r.starts_at, r.ends_at) l
       group by l.user_id;
    -- Everyone who moved on every day of it.
    insert into public.honours (user_id, kind, tier, count)
    select user_id, 'diamond', 'bronze', 0 from t_round where active_days >= r.days
    on conflict do nothing;
    -- The most gym sessions (ties share it).
    insert into public.honours (user_id, kind, tier, count)
    select user_id, 'strength', 'bronze', 0 from t_round
     where gym > 0 and gym = (select max(gym) from t_round)
    on conflict do nothing;
    drop table t_round;
  end loop;
  -- Count the rounds each one holds, then set the tier from the count. Rounds
  -- are only ever added, so counting again is the simplest way to be exact.
  create temp table t_rounds on commit drop as
    select rd.id, rd.starts_at, rd.ends_at,
           ((rd.ends_at at time zone 'Europe/London')::date - (rd.starts_at at time zone 'Europe/London')::date)::int as days
      from public.series_rounds rd where rd.published and rd.ends_at <= now();
  for r in
    select h.user_id,
           (select count(*) from t_rounds rd
             where (select count(distinct l.day) from public._series_ledger(rd.starts_at, rd.ends_at) l where l.user_id = h.user_id and l.counts) >= rd.days)::int as n
      from public.honours h where h.kind = 'diamond'
  loop
    perform public._honour_set(r.user_id, 'diamond', r.n);
  end loop;
  for r in
    select h.user_id,
           (select count(*) from t_rounds rd
             where (select count(*) from public._series_ledger(rd.starts_at, rd.ends_at) l where l.user_id = h.user_id and l.counts and l.type = 'gym') > 0
               and (select count(*) from public._series_ledger(rd.starts_at, rd.ends_at) l where l.user_id = h.user_id and l.counts and l.type = 'gym')
                   = (select max(c) from (select count(*) as c from public._series_ledger(rd.starts_at, rd.ends_at) l where l.counts and l.type = 'gym' group by l.user_id) m))::int as n
      from public.honours h where h.kind = 'strength'
  loop
    perform public._honour_set(r.user_id, 'strength', r.n);
  end loop;

  -- ── Wings: Level Up wins on record ─────────────────────────────────────────
  for r in
    select user_id, count(*)::int as n from public.series_results
     where kind = 'biggest_mover' and status <> 'void' group by user_id
  loop
    perform public._honour_set(r.user_id, 'wings', r.n);
  end loop;

  -- ── The Hive: friends who joined with your code and have worked out ────────
  for r in
    select referrer_id as user_id, count(*)::int as n from public.referrals
     where converted_at is not null group by referrer_id
  loop
    perform public._honour_set(r.user_id, 'hive', r.n);
  end loop;

  -- ── King: Nº 1 on a round's board at the close of a day ────────────────────
  -- Run just after midnight, so the field as it stands is yesterday's close.
  -- A round's last night counts (it ended at midnight, the field is final).
  for r in
    select id from public.series_rounds
     where published and starts_at < now() and ends_at > now() - interval '1 day'
  loop
    perform public._honour_set(f.user_id, 'king', coalesce(h.count, 0) + 1, v_today - 1)
       from (select user_id from public._series_field(r.id) where not pacer and listed and points > 0
              order by points desc, user_id limit 1) f
       left join public.honours h on h.user_id = f.user_id and h.kind = 'king'
      where h.last_day is null or h.last_day < v_today - 1;
  end loop;

  drop table if exists t_weeks;
  drop table if exists t_rounds;
end;
$$;

revoke all on function public.award_honours() from public, anon, authenticated;
revoke all on function public._honour_set(uuid, text, int, date) from public, anon, authenticated;

-- Honours for a set of members, for the board: every row's and the rival's in one call.
create or replace function public.get_honours(p_users uuid[])
returns table (user_id uuid, kind text, tier text, count int)
language sql
stable
security definer
set search_path = public
as $$
  select h.user_id, h.kind, h.tier, h.count
    from public.honours h
   where h.user_id = any (p_users)
     and auth.uid() is not null
   order by h.user_id,
            case h.kind when 'king' then 0 when 'diamond' then 1 when 'wings' then 2 when 'strength' then 3 when 'hive' then 4 when 'power' then 5 else 6 end
$$;
grant execute on function public.get_honours(uuid[]) to authenticated;

select cron.unschedule('honours') where exists (select 1 from cron.job where jobname = 'honours');
-- 00:20 UTC: past London midnight all year, so King reads yesterday's close.
select cron.schedule('honours', '20 0 * * *', $cron$ select public.award_honours() $cron$);
