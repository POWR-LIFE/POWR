-- =============================================================
-- GYM BOARDS — a weekly leaderboard per gym, on the gym's own screen
--
-- Jamie (09-10): "a leaderboard per gym location … how users are
-- performing week by week that a gym can have on a large screen, just
-- like we did for the most recent live event. We send them a url they
-- can just open on a big screen."
--
-- Same shape as the live-event big screen (powr.life/live/<slug>?k=):
--   * one row per partner in gym_boards — slug (the URL) + display_token
--     (the credential: unguessable, admin-regenerable, display-only)
--   * an edge fn (gym-board) holds the service-role client, validates the
--     token and calls gym_board_payload(); nothing here is callable by
--     anon/authenticated (definer-lint budget, see 20260820185024).
--
-- Scoring = "points earned at THIS gym this week":
--   ledger rows of type earn / adjustment / penalty whose session carries
--   partner_id = the gym and whose ACTIVITY overlaps the week (activity
--   time, not credit time — same rule as _live_event_counted). Streak and
--   bonus rows never buy rank (post-#221 split, same as leaderboard_weekly);
--   penalties always subtract. Only profiles with show_on_leaderboard.
--
-- Week = Monday 00:00 in the board's timezone (Europe/London by default —
-- the global views roll over at UTC midnight, which on a UK gym wall in
-- summer is 1am Monday; a gym screen should turn over with the gym's day).
-- Rank movement (▲/▼) = rank at the start of the local day vs now, computed
-- from the ledger both times — no snapshot cron needed at this scale.
-- =============================================================

create table if not exists public.gym_boards (
  partner_id    uuid primary key references public.partners(id) on delete cascade,
  slug          text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 64),
  -- Gates the big-screen URL. Regenerate to kill old links.
  display_token text not null
                  default encode(gen_random_bytes(24), 'hex'),
  enabled       boolean not null default true,
  board_size    integer not null default 25 check (board_size between 3 and 100),
  tz            text not null default 'Europe/London',
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.gym_boards is
  'Per-gym weekly leaderboard screen (powr.life/gym/<slug>?k=<display_token>). Admin-managed; read by the gym-board edge fn with service role.';

alter table public.gym_boards enable row level security;

drop policy if exists "Admins manage gym boards" on public.gym_boards;
create policy "Admins manage gym boards"
  on public.gym_boards for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- The board is a per-gym, per-week scan of sessions. The existing index is
-- on partner_id alone; the week bound wants started_at beside it.
create index if not exists activity_sessions_partner_started_idx
  on public.activity_sessions (partner_id, started_at desc)
  where partner_id is not null;

-- ── Scores for one gym over one window ─────────────────────────────────────
-- Everyone with a session at the gym in the window, ranked by counted
-- points. Callers drop score <= 0 for display; the rows still feed the
-- "members active" stat.

create or replace function public._gym_board_scores(
  p_partner_id uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_tz         text default 'Europe/London'
)
returns table (
  user_id         uuid,
  score           integer,
  sessions        integer,
  active_days     integer,
  last_counted_at timestamptz,
  rank            bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with sess as (
    select s.id, s.user_id, s.started_at, coalesce(s.ended_at, s.started_at) as ended_at
    from public.activity_sessions s
    where s.partner_id = p_partner_id
      and coalesce(s.ended_at, s.started_at) > p_from
      and s.started_at < p_to
  ),
  pts as (
    select pt.user_id, pt.amount, pt.created_at
    from public.point_transactions pt
    join sess s on s.id = pt.session_id
    where pt.type in ('earn', 'adjustment', 'penalty')
  ),
  per_user as (
    select
      s.user_id,
      count(distinct s.id)::integer                                  as sessions,
      count(distinct (s.started_at at time zone p_tz)::date)::integer as active_days
    from sess s
    group by s.user_id
  )
  select
    u.user_id,
    coalesce(sum(pt.amount), 0)::integer as score,
    u.sessions,
    u.active_days,
    max(pt.created_at)                   as last_counted_at,
    rank() over (
      order by coalesce(sum(pt.amount), 0) desc,
               max(pt.created_at) asc nulls last,
               u.user_id asc
    ) as rank
  from per_user u
  join public.profiles p on p.id = u.user_id and p.show_on_leaderboard = true
  left join pts pt on pt.user_id = u.user_id
  group by u.user_id, u.sessions, u.active_days
$$;

revoke all on function public._gym_board_scores(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public._gym_board_scores(uuid, timestamptz, timestamptz, text) to service_role;

-- ── The screen's whole payload, minus profile bits ─────────────────────────
-- User ids are returned here and resolved (then hashed away) by the edge fn;
-- this function is never exposed to clients.

create or replace function public.gym_board_payload(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz         text;
  v_size       integer;
  v_local_now  timestamp;
  v_week_start timestamptz;
  v_week_end   timestamptz;
  v_prev_start timestamptz;
  v_day_start  timestamptz;
  v_standings  jsonb;
  v_stats      jsonb;
  v_last_week  jsonb;
  v_members    integer;
begin
  select tz, board_size into v_tz, v_size from public.gym_boards where partner_id = p_partner_id;
  if not found then
    return null;
  end if;

  v_local_now  := now() at time zone v_tz;
  v_week_start := date_trunc('week', v_local_now) at time zone v_tz;
  v_week_end   := (date_trunc('week', v_local_now) + interval '7 days') at time zone v_tz;
  v_prev_start := (date_trunc('week', v_local_now) - interval '7 days') at time zone v_tz;
  v_day_start  := date_trunc('day', v_local_now) at time zone v_tz;

  -- This week, with movement since the local day began. On Monday the
  -- day start IS the week start: nothing to compare against → no arrows.
  with now_rows as (
    select * from public._gym_board_scores(p_partner_id, v_week_start, v_week_end, v_tz)
    where score > 0
  ),
  then_rows as (
    select user_id, rank as prev_rank
    from public._gym_board_scores(p_partner_id, v_week_start, v_day_start, v_tz)
    where v_day_start > v_week_start and score > 0
  ),
  ranked as (
    select n.user_id, n.score, n.sessions, n.active_days, n.rank, t.prev_rank
    from now_rows n
    left join then_rows t on t.user_id = n.user_id
    order by n.rank
    limit v_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',     r.user_id,
           'score',       r.score,
           'sessions',    r.sessions,
           'active_days', r.active_days,
           'rank',        r.rank,
           'prev_rank',   r.prev_rank
         ) order by r.rank), '[]'::jsonb)
    into v_standings
  from ranked r;

  select jsonb_build_object(
           'members',  count(*),
           'points',   coalesce(sum(greatest(score, 0)), 0),
           'sessions', coalesce(sum(sessions), 0)
         )
    into v_stats
  from public._gym_board_scores(p_partner_id, v_week_start, v_week_end, v_tz);

  -- Last week's podium — the wall remembers who won.
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',  s.user_id,
           'score',    s.score,
           'sessions', s.sessions,
           'rank',     s.rank
         ) order by s.rank), '[]'::jsonb)
    into v_last_week
  from (
    select * from public._gym_board_scores(p_partner_id, v_prev_start, v_week_start, v_tz)
    where score > 0
    order by rank
    limit 3
  ) s;

  -- Everyone who has ever trained here on POWR (the "community" number).
  select count(distinct s.user_id) into v_members
  from public.activity_sessions s
  join public.profiles p on p.id = s.user_id and p.show_on_leaderboard = true
  where s.partner_id = p_partner_id;

  return jsonb_build_object(
    'tz',             v_tz,
    'week_start_at',  v_week_start,
    'week_end_at',    v_week_end,
    'day_start_at',   v_day_start,
    'standings',      v_standings,
    'stats',          v_stats,
    'last_week',      jsonb_build_object(
                        'week_start_at', v_prev_start,
                        'week_end_at',   v_week_start,
                        'podium',        v_last_week
                      ),
    'community',      v_members
  );
end;
$$;

revoke all on function public.gym_board_payload(uuid) from public, anon, authenticated;
grant execute on function public.gym_board_payload(uuid) to service_role;
