-- The Autumn Series, made real. Round 01 = 1–15 Nov 2026, Round 02 = 1–15 Dec.
--
-- What's here:
--   1. series_rounds                  the rounds (01 and 02 seeded)
--   2. _series_is_demo                the POWR gym demo people (seed 'powr-gym-demo')
--                                     never reach a board, a count or a push
--   3. _series_ledger(from, to)       THE scoring rule, in one place
--   4. _series_points(round)          per-person totals for a round
--   5. get_series_board(slug)         everything the League tab shows, in one call.
--                                     SECURITY DEFINER on purpose: the league views
--                                     are security_invoker over point_transactions,
--                                     whose SELECT policy is self-or-admin, so a
--                                     member sees everyone else at 0. This returns
--                                     only names, avatars and Series totals.
--   6. series_duels + series_challenge / series_respond     the Friends tab
--   7. the two Series pushes: series_rank_snapshots, series_push_log,
--      series_dispatch_pushes() on a 15-minute cron, notification_config rows,
--      notification_preferences.series_updates
--   8. admin_series_round_stats(slug) how a round is doing (The Draw, coming back)
--
-- The scoring rule (_series_ledger):
--   * a session counts if it's verified (verification <> 'manual'), not flagged
--     (duplicate / multi-device), not sleep, and STARTED inside the window;
--   * its points are what POWR already paid for it: the earn + streak rows that
--     carry its session_id (a rejected session is deleted, so its points drop out);
--   * per London day only the first 120 active minutes count. Sessions are taken
--     in start order and one counts if it starts inside the budget; POWR pays by
--     tier, so a session is all or nothing. Walking is exempt: it is one daily
--     step-tier session spanning the day, already capped at 5 by claim-points;
--   * a day "logged" (The Draw) is a London day with at least one paying session.
--
-- Checked read-only against prod on 20 Oct (last 15 days, demo excluded): 133
-- entrants, 50 moved, #1 on 390, #20 on 110; the 120-minute rule changed one
-- person's total (434 → 253).

-- ── 1. Rounds ────────────────────────────────────────────────────────────────

create table if not exists public.series_rounds (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  -- Log on this many days of the round to be in The Draw.
  draw_days  int not null default 10,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.series_rounds enable row level security;
drop policy if exists series_rounds_read on public.series_rounds;
create policy series_rounds_read on public.series_rounds for select to authenticated using (true);

insert into public.series_rounds (slug, name, starts_at, ends_at) values
  ('autumn-01', 'Round 01', '2026-11-01 00:00 Europe/London', '2026-11-16 00:00 Europe/London'),
  ('autumn-02', 'Round 02', '2026-12-01 00:00 Europe/London', '2026-12-16 00:00 Europe/London')
on conflict (slug) do nothing;

-- ── 2. Demo people ───────────────────────────────────────────────────────────

create or replace function public._series_is_demo(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_uid and u.raw_app_meta_data->>'seed' = 'powr-gym-demo'
  );
$$;

-- ── 3. The scoring rule ──────────────────────────────────────────────────────

create or replace function public._series_ledger(p_from timestamptz, p_to timestamptz)
returns table (
  user_id    uuid,
  session_id uuid,
  day        date,
  type       public.activity_type,
  partner_id uuid,
  started_at timestamptz,
  pts        int,
  counts     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select a.id, a.user_id, a.type, a.partner_id, a.started_at, a.duration_sec,
           (a.started_at at time zone 'Europe/London')::date as d,
           coalesce((select sum(pt.amount)
                       from public.point_transactions pt
                      where pt.session_id = a.id and pt.type in ('earn', 'streak')), 0)::int as pts
      from public.activity_sessions a
     where a.started_at >= p_from
       and a.started_at < least(p_to, now())
       and a.verification <> 'manual'
       and not coalesce(a.flagged, false)
       and a.type <> 'sleep'
       and not public._series_is_demo(a.user_id)
  )
  select s.user_id, s.id, s.d, s.type, s.partner_id, s.started_at, s.pts,
         s.type = 'walking'
           or coalesce(sum(case when s.type = 'walking' then 0 else s.duration_sec end)
                over (partition by s.user_id, s.d order by s.started_at, s.id
                      rows between unbounded preceding and 1 preceding), 0) < 120 * 60
    from s;
$$;

-- ── 4. Per-person totals for a round ─────────────────────────────────────────

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
   group by p.id, p.show_on_leaderboard, r.day1, lon.today;
$$;

-- ── 6. Duels (the Friends tab) — tables first, the board reads them ──────────

create table if not exists public.series_duels (
  id          uuid primary key default gen_random_uuid(),
  challenger  uuid not null references public.profiles(id) on delete cascade,
  opponent    uuid not null references public.profiles(id) on delete cascade,
  -- The London Monday of the week the duel is scored on (Mon 00:00 – Sun 23:59).
  week_start  date not null,
  status      text not null default 'pending' check (status in ('pending', 'active', 'declined', 'done')),
  winner      uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  check (challenger <> opponent)
);

-- One duel per pair per week.
create unique index if not exists series_duels_pair_week
  on public.series_duels (least(challenger, opponent), greatest(challenger, opponent), week_start)
  where status in ('pending', 'active', 'done');

alter table public.series_duels enable row level security;
drop policy if exists series_duels_own on public.series_duels;
create policy series_duels_own on public.series_duels
  for select to authenticated using ((select auth.uid()) in (challenger, opponent));
-- Writes only through series_challenge / series_respond / the weekly close.

create or replace function public.series_challenge(p_friend uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mon date := date_trunc('week', now() at time zone 'Europe/London')::date;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and f.user_id = least(v_uid, p_friend) and f.friend_id = greatest(v_uid, p_friend)
  ) then
    raise exception 'you can only duel a friend' using errcode = '42501';
  end if;
  insert into public.series_duels (challenger, opponent, week_start)
  values (v_uid, p_friend, v_mon)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.series_respond(p_duel uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.series_duels
     set status = case when p_accept then 'active' else 'declined' end,
         accepted_at = case when p_accept then now() end
   where id = p_duel and opponent = v_uid and status = 'pending'
     and week_start = date_trunc('week', now() at time zone 'Europe/London')::date;
  return found;
end;
$$;

-- Last week's duels get a winner; unanswered challenges lapse. Run by the cron.
create or replace function public._series_close_duels()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  with ended as (
    select d.id, d.challenger, d.opponent,
           (select coalesce(sum(l.pts) filter (where l.counts), 0)
              from public._series_ledger(d.week_start::timestamp at time zone 'Europe/London',
                                         (d.week_start + 7)::timestamp at time zone 'Europe/London') l
             where l.user_id = d.challenger) as cp,
           (select coalesce(sum(l.pts) filter (where l.counts), 0)
              from public._series_ledger(d.week_start::timestamp at time zone 'Europe/London',
                                         (d.week_start + 7)::timestamp at time zone 'Europe/London') l
             where l.user_id = d.opponent) as op
      from public.series_duels d
     where d.status = 'active' and d.week_start + 7 <= v_today
  )
  update public.series_duels d
     set status = 'done',
         winner = case when e.cp > e.op then e.challenger when e.op > e.cp then e.opponent end
    from ended e
   where d.id = e.id;

  update public.series_duels set status = 'declined'
   where status = 'pending' and week_start + 7 <= v_today;
end;
$$;

-- ── 5. The board ─────────────────────────────────────────────────────────────
-- One call for the League tab. state: 'upcoming' before Round 01, 'running'
-- during a round, 'ended' between rounds (the screen shows how it finished).
-- rows = the top 3 plus the one above you, you and the two below.
-- rival = a friend just above you within reach (30 pts), else the one directly
-- above you, else (you're #1) the one chasing you. Home and the morning push
-- use the same rule.

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

  if p_slug is not null then
    select * into v_round from public.series_rounds where slug = p_slug;
  else
    select * into v_round from public.series_rounds
     where now() >= starts_at and now() < ends_at order by starts_at limit 1;
    if v_round.id is null then
      select * into v_round from public.series_rounds where ends_at <= now() order by ends_at desc limit 1;
    end if;
    if v_round.id is null then
      select * into v_round from public.series_rounds order by starts_at limit 1;
    end if;
  end if;
  if v_round.id is null then
    return null;
  end if;
  v_state := case when now() < v_round.starts_at then 'upcoming'
                  when now() < v_round.ends_at then 'running'
                  else 'ended' end;
  select * into v_next from public.series_rounds where starts_at > now() order by starts_at limit 1;
  v_day1 := (v_round.starts_at at time zone 'Europe/London')::date;
  select preferred_gym_id into v_gym from public.profiles where id = v_uid;

  with pts as materialized (
    select * from public._series_points(v_round.id) where listed or user_id = v_uid
  ),
  ranked as (
    select pts.*,
           row_number() over (order by points desc, user_id)::int as rank,
           row_number() over (order by points_mid desc, user_id)::int as rank_mid
      from pts
  ),
  named as (
    select r.*, coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') as name, p.avatar_url
      from ranked r join public.profiles p on p.id = r.user_id
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
  -- The crown: rolling 7 days, sessions verified AT your home gym, anyone's.
  court as (
    select l.user_id, coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') as name,
           (sum(l.pts) filter (where l.counts))::int as points
      from public._series_ledger(now() - interval '7 days', now()) l
      join public.profiles p on p.id = l.user_id
     where v_gym is not null and l.partner_id = v_gym
       and (coalesce(p.show_on_leaderboard, true) or p.id = v_uid)
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
              'user_id', user_id, 'name', name, 'avatar_url', avatar_url, 'rank', rank, 'rank_mid', rank_mid,
              'points', points, 'today', today, 'you', user_id = v_uid) order by rank) from shown), '[]'::jsonb),
    'rival', (select jsonb_build_object('user_id', user_id, 'name', name, 'rank', rank, 'points', points,
                                        'today', today, 'friend', friend) from rival),
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

-- ── 7. The Series pushes ─────────────────────────────────────────────────────
-- series_rival  08:00 local, during a round, to everyone with points this round:
--               your rival, the gap, and the one session that closes it.
-- series_passed checked every 15 minutes: the person now directly above you was
--               behind you at the last check. At most once a day.
-- Both are 'social' with a daily cap of 1, so they never use up the one
-- nudge-class push a day that streak_at_risk relies on. The round's big moments
-- (it starts, Final 48, results) go out as scheduled broadcasts from /admin.

create table if not exists public.series_rank_snapshots (
  round_id uuid not null references public.series_rounds(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  rank     int not null,
  points   int not null,
  taken_at timestamptz not null default now(),
  primary key (round_id, user_id)
);
alter table public.series_rank_snapshots enable row level security;

create table if not exists public.series_push_log (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  kind      text not null,
  local_day date not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, kind, local_day)
);
alter table public.series_push_log enable row level security;

alter table public.notification_preferences
  add column if not exists series_updates boolean not null default true;

-- Seeded OFF: the Series screen is dev-only until launch, and a push about a
-- board nobody can open is worse than none. Switch both on from the admin
-- Notifications tab on launch day; the dispatcher skips a type while it's off.
insert into public.notification_config (type, category, description, class, daily_cap, enabled) values
  ('series_rival', 'social',
   'Autumn Series: the 08:00 push about your rival — the gap and the one session that closes it (only during a round, only to people with points this round)', 'social', 1, false),
  ('series_passed', 'social',
   'Autumn Series: someone just passed you on the board (checked every 15 minutes, at most once a day)', 'social', 1, false)
on conflict (type) do nothing;

-- A bad timezone string on a profile must not stop everyone else's push.
create or replace function public._series_local_now(p_tz text)
returns timestamp
language plpgsql
stable
as $$
begin
  return now() at time zone coalesce(nullif(p_tz, ''), 'Europe/London');
exception when others then
  return now() at time zone 'Europe/London';
end;
$$;

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
   where now() >= starts_at and now() < ends_at order by starts_at limit 1;
  if v_round.id is null then
    return jsonb_build_object('round', null);
  end if;

  -- Someone passed you since the last check.
  for r in
    with st as materialized (
      select p.user_id, p.points, row_number() over (order by p.points desc, p.user_id)::int as rank
        from public._series_points(v_round.id) p
       where p.listed
    )
    select me.user_id, me.rank, me.points, a.points as by_points, pr.timezone,
           coalesce(nullif(trim(ap.display_name), ''), ap.username, 'Someone') as by_name
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
      join public.profiles ap on ap.id = a.user_id
     where me.rank > sn.rank
       and me.points > 0
       and 'series_passed' = any (v_on)
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
      select p.user_id, p.points, row_number() over (order by p.points desc, p.user_id)::int as rank
        from public._series_points(v_round.id) p
       where p.listed
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
     where me.points > 0
       and 'series_rival' = any (v_on)
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
          'name', (select coalesce(nullif(trim(p.display_name), ''), p.username, 'Your rival') from public.profiles p where p.id = r.rv_id),
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

    -- Remember where everyone stands for the next check.
    insert into public.series_rank_snapshots (round_id, user_id, rank, points, taken_at)
    select v_round.id, s.user_id, s.rank, s.points, now()
      from (
        select p.user_id, p.points, row_number() over (order by p.points desc, p.user_id)::int as rank
          from public._series_points(v_round.id) p
         where p.listed
      ) s
    on conflict (round_id, user_id) do update
      set rank = excluded.rank, points = excluded.points, taken_at = excluded.taken_at;
  end if;

  return jsonb_build_object('round', v_round.slug, 'passed', v_passed, 'rival', v_rival, 'dry_run', p_dry_run);
end;
$$;

do $job$
begin
  perform cron.unschedule('series-pushes');
exception when others then null;
end
$job$;

select cron.schedule('series-pushes', '*/15 * * * *', $cron$ select public.series_dispatch_pushes() $cron$);

-- ── 8. How a round is doing (admin) ──────────────────────────────────────────
-- in_the_draw = logged on draw_days or more days; came_back = moved in the
-- round's first 7 days AND again in days 8–15 (the round's own "D7").

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

  with pts as (select * from public._series_points(v_round.id) where listed)
  select jsonb_build_object(
    'round', v_round.slug,
    'entrants', (select count(*) from pts),
    'moved', (select count(*) from pts where points > 0),
    'in_the_draw', (select count(*) from pts where cardinality(days) >= v_round.draw_days),
    'avg_days_logged', (select round(avg(cardinality(days))::numeric, 1) from pts where points > 0),
    'week1_movers', (select count(*) from pts where exists (select 1 from unnest(days) d where d <= 7)),
    'came_back', (select count(*) from pts
                   where exists (select 1 from unnest(days) d where d <= 7)
                     and exists (select 1 from unnest(days) d where d >= 8))
  ) into v_out;
  return v_out;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke all on function public._series_is_demo(uuid) from public, anon, authenticated;
revoke all on function public._series_ledger(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._series_points(uuid) from public, anon, authenticated;
revoke all on function public._series_close_duels() from public, anon, authenticated;
revoke all on function public._series_local_now(text) from public, anon, authenticated;
revoke all on function public.series_dispatch_pushes(boolean) from public, anon, authenticated;
grant execute on function public._series_is_demo(uuid) to service_role;
grant execute on function public._series_ledger(timestamptz, timestamptz) to service_role;
grant execute on function public._series_points(uuid) to service_role;
grant execute on function public._series_close_duels() to service_role;
grant execute on function public._series_local_now(text) to service_role;
grant execute on function public.series_dispatch_pushes(boolean) to service_role;

revoke all on function public.get_series_board(text) from public, anon;
revoke all on function public.series_challenge(uuid) from public, anon;
revoke all on function public.series_respond(uuid, boolean) from public, anon;
revoke all on function public.admin_series_round_stats(text) from public, anon;
grant execute on function public.get_series_board(text) to authenticated;
grant execute on function public.series_challenge(uuid) to authenticated;
grant execute on function public.series_respond(uuid, boolean) to authenticated;
grant execute on function public.admin_series_round_stats(text) to authenticated;
