-- =============================================================
-- Live event board: rank movement arrows (▲ n / ▼ n)
--
-- Jamie (08-30): "we should have an arrow that indicates if someone has
-- moved up or down to show the movements of users more visually."
--
-- The board is recomputed from the ledger on every read — nothing remembers
-- where anyone WAS. So: a cron captures the live board every 15 minutes
-- into live_event_rank_snapshots, and each board row now carries
--   rank_delta = rank at the REFERENCE snapshot − rank now
-- (positive = climbed, negative = dropped, null = wasn't on the board then).
--
-- Reference = the last snapshot taken at or before the start of the CURRENT
-- SCORING DAY on the event's own day grid (window_start_at + n·24h) — the
-- same "today" the "+N TODAY" chip counts (20260829190000), so ▲2 and
-- +85 TODAY describe the same stretch of time. Before the first day
-- boundary has a snapshot behind it (feature just shipped, or day 1) the
-- earliest snapshot stands in, so the arrows mean "since the board was
-- first captured" today and "since the day began" from tomorrow on.
--
-- Snapshots keep only rows with score > 0: the scorer returns every
-- eligible profile (global scope = the whole member base) tied at the
-- bottom on 0, and "movement" among zeros is noise. A 0→N entrant has no
-- reference row → null → no arrow, never a fake ▲.
--
-- Same gate mode as the board (_live_event_scores(id, mode = 'entry')) so
-- the two rank sequences are comparable. Frozen results (revealed/settled)
-- get no delta — nothing moves after Reveal. Preview theatre rows carry
-- fixed sample deltas so the admin walkthrough shows the arrows.
--
-- Body of get_event_leaderboard = 20260829190000 (prod md5 verified
-- fc79c83a… before this was written) + the three rank_delta splices.
-- =============================================================

-- ── 1. Snapshot table — definer RPCs + service role only, never client-read ─

create table if not exists public.live_event_rank_snapshots (
  event_id    uuid        not null references public.live_events(id) on delete cascade,
  user_id     uuid        not null,
  rank        integer     not null,
  points      integer     not null,
  captured_at timestamptz not null,
  primary key (event_id, captured_at, user_id)
);

comment on table public.live_event_rank_snapshots is
  'Live-event board captured every 15 min by live_event_snapshot_ranks(); feeds rank_delta (▲/▼) on board rows. Score > 0 rows only; pruned after 3 days.';

alter table public.live_event_rank_snapshots enable row level security;
revoke all on public.live_event_rank_snapshots from public, anon, authenticated;

-- ── 2. Capture — pg_cron every 15 minutes while an event is live ────────────

create or replace function public.live_event_snapshot_ranks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n  integer := 0;
  v_c  integer;
  v_at timestamptz := now();
  r    record;
begin
  for r in
    select e.id, e.entry_gate_mode
      from public.live_events e
     where e.status = 'live'
       and now() >= e.window_start_at
       and now() <  e.window_end_at
  loop
    insert into public.live_event_rank_snapshots (event_id, user_id, rank, points, captured_at)
    select r.id, s.user_id, s.rank::int, s.score, v_at
      from public._live_event_scores(r.id, r.entry_gate_mode = 'entry') s
     where s.score > 0;
    get diagnostics v_c = row_count;
    v_n := v_n + v_c;
  end loop;

  -- The reference is never older than yesterday's last capture; three days
  -- is headroom, not history.
  delete from public.live_event_rank_snapshots
   where captured_at < now() - interval '3 days';

  return v_n;
end;
$$;

revoke all on function public.live_event_snapshot_ranks() from public, anon, authenticated;

select cron.schedule(
  'live-event-rank-snapshots',
  '*/15 * * * *',
  $$select public.live_event_snapshot_ranks()$$
);

-- ── 3. Reference snapshot + per-user previous rank ──────────────────────────

create or replace function public._live_event_rank_ref_at(p_event_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select window_start_at from public.live_events where id = p_event_id
  ),
  day as (
    -- start of the current scoring day on the event's day grid — identical
    -- arithmetic to _live_event_row_extras so TODAY and ▲/▼ share a clock.
    select ev.window_start_at
           + greatest(floor(extract(epoch from (now() - ev.window_start_at)) / 86400), 0) * interval '1 day'
           as start_at
    from ev
  )
  select coalesce(
    (select max(s.captured_at)
       from public.live_event_rank_snapshots s, day
      where s.event_id = p_event_id
        and s.captured_at <= day.start_at),
    (select min(s.captured_at)
       from public.live_event_rank_snapshots s
      where s.event_id = p_event_id)
  );
$$;

create or replace function public._live_event_rank_deltas(p_event_id uuid)
returns table (user_id uuid, prev_rank integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, s.rank
    from public.live_event_rank_snapshots s
   where s.event_id = p_event_id
     and s.captured_at = public._live_event_rank_ref_at(p_event_id);
$$;

revoke execute on function public._live_event_rank_ref_at(uuid) from public, anon, authenticated;
revoke execute on function public._live_event_rank_deltas(uuid) from public, anon, authenticated;
-- The venue screen (event-board edge fn) reads deltas with the service key.
grant execute on function public._live_event_rank_deltas(uuid) to service_role;

-- ── 4. get_event_leaderboard — rows and the viewer carry rank_delta ─────────

create or replace function public.get_event_leaderboard(p_event_id uuid, p_preview_state text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_event     public.live_events;
  v_preview   boolean := false;
  v_state     text;
  v_forced    boolean;
  v_status    text;
  v_locked    boolean;
  v_enforce   boolean;
  v_standings jsonb;
  v_results   jsonb;
  v_viewer    jsonb;
  v_own       jsonb;
  v_rank      integer;
  v_points    integer;
  v_gate_req  integer;
  v_gate_have integer;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events
   where id = p_event_id and status <> 'archived';
  if not found then
    return null;
  end if;

  if v_event.status = 'draft' then
    v_preview := public._live_event_previewer(v_event, v_uid);
    if not v_preview then
      return null;
    end if;
  end if;

  v_state := case
    when not v_preview then 'auto'
    when p_preview_state in ('auto', 'gated', 'live', 'locked', 'revealed')
      then p_preview_state
    else v_event.preview_board_state
  end;
  v_forced := v_preview and v_state <> 'auto';

  v_status := case
    when not v_preview then v_event.status
    when now() >= v_event.window_start_at and now() < v_event.window_end_at then 'live'
    else 'scheduled'
  end;

  v_locked := v_event.status = 'locked'
              or v_event.hidden
              or (v_event.lock_at is not null and now() >= v_event.lock_at);
  -- gate mode: 'entry' keeps the door on the LIVE board; 'deadline' opens it
  -- and leaves the requirement to Settle.
  v_enforce := v_event.entry_gate_mode = 'entry';
  v_viewer := public._live_event_viewer(v_event, v_uid);

  v_own := case
    when now() >= v_event.window_start_at
     and (v_viewer->>'eligible')::boolean
     and ((v_viewer->>'joined')::boolean or v_event.scope = 'global')
    then jsonb_build_object('points', public._live_event_user_points(v_event.id, v_uid))
    else '{}'::jsonb
  end;

  if v_forced and v_state = 'locked' then
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   'live',
      'is_locked', true,
      'is_preview', true,
      'viewer',   v_viewer || v_own
    );
  end if;

  if v_forced and v_state = 'gated' then
    v_gate_req  := greatest(v_event.entry_gate_n, 3);
    v_gate_have := least(
      coalesce(public._live_event_gate_count(v_event.id, v_uid), 0),
      v_gate_req - 1
    );

    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   'live',
      'is_locked', false,
      'is_gated',  true,
      'is_preview', true,
      'viewer',   v_viewer || v_own || jsonb_build_object(
        'gate', jsonb_build_object(
          'required',    v_gate_req,
          'counting',    v_event.entry_gate_counting,
          'count',       v_gate_have,
          'met',         false,
          'mode',        'entry',
          'deadline_at', public._live_event_gate_deadline(v_event)
        ))
    );
  end if;

  if v_forced and v_state = 'revealed' then
    select jsonb_agg(jsonb_build_object(
             'rank',         r.rnk,
             'user_id',      r.uid,
             'display_name', r.display_name,
             'username',     r.username,
             'avatar_url',   r.avatar_url,
             'is_pro',       false,
             'points',       r.points,
             'prize_label',  (select pz->>'label' from jsonb_array_elements(v_event.prizes) pz
                               where (pz->>'rank')::int = r.rnk limit 1)
           ) order by r.rnk)
      into v_results
      from (
        select x.rnk,
               case when x.rnk = 4 then v_uid::text else x.uid end as uid,
               case when x.rnk = 4 then coalesce(p.display_name, p.username, 'You') else x.display_name end as display_name,
               case when x.rnk = 4 then p.username else null end as username,
               case when x.rnk = 4 then p.avatar_url else null end as avatar_url,
               x.points
          from (values
                 (1, '00000000-0000-4000-8000-000000000001', 'Maya K',    1240),
                 (2, '00000000-0000-4000-8000-000000000002', 'Jordan R',  1105),
                 (3, '00000000-0000-4000-8000-000000000003', 'Alex T',     990),
                 (4, null,                                    null,         875),
                 (5, '00000000-0000-4000-8000-000000000005', 'Riley P',    760),
                 (6, '00000000-0000-4000-8000-000000000006', 'Charlie B',  655),
                 (7, '00000000-0000-4000-8000-000000000007', 'Ash M',      540),
                 (8, '00000000-0000-4000-8000-000000000008', 'Nova S',     430)
               ) as x(rnk, uid, display_name, points)
          left join public.profiles p on p.id = v_uid
      ) r;

    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   'revealed',
      'is_locked', true,
      'is_preview', true,
      'results',  coalesce(v_results, '[]'::jsonb),
      'viewer',   v_viewer || jsonb_build_object(
        'rank', 4, 'points', 875,
        'prize_label', (select pz->>'label' from jsonb_array_elements(v_event.prizes) pz
                         where (pz->>'rank')::int = 4 limit 1))
    );
  end if;

  if v_forced and v_state = 'live' then
    v_status := 'live';
    v_locked := false;
  end if;

  if v_event.status in ('revealed', 'settled') then
    select jsonb_agg(jsonb_build_object(
             'rank',         r.rank,
             'user_id',      r.user_id,
             'display_name', p.display_name,
             'username',     p.username,
             'avatar_url',   p.avatar_url,
             'is_pro',       p.is_pro,
             'points',       r.final_points,
             'prize_label',  r.prize_label,
             'total_earned', x.total_earned,
             'today_points', x.today_points
           ) order by r.rank)
      into v_results
      from public.live_event_results r
      join public.profiles p on p.id = r.user_id
      cross join lateral public._live_event_row_extras(v_event.id, r.user_id) x
     where r.event_id = v_event.id;

    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_event.status,
      'is_locked', true,
      'results',  coalesce(v_results, '[]'::jsonb),
      'viewer',   v_viewer || coalesce((
        select jsonb_build_object('rank', r.rank, 'points', r.final_points,
                                  'prize_label', r.prize_label)
        from public.live_event_results r
        where r.event_id = v_event.id and r.user_id = v_uid
      ), '{}'::jsonb)
    );
  end if;

  if v_status <> 'live' or v_locked then
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_status,
      'is_locked', v_locked,
      'viewer',   v_viewer || v_own
    ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
  end if;

  if not v_forced
     and v_enforce                                                    -- gate mode
     and v_event.entry_gate_n > 0
     and public._live_event_gate_count(v_event.id, v_uid) < v_event.entry_gate_n then
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_status,
      'is_locked', false,
      'is_gated',  true,
      'viewer',   v_viewer || v_own
    ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
  end if;

  if v_forced and v_state = 'live' then
    select jsonb_agg(jsonb_build_object(
             'rank',         m.rnk,
             'user_id',      m.uid,
             'display_name', m.display_name,
             'username',     m.username,
             'avatar_url',   m.avatar_url,
             'is_pro',       m.is_pro,
             'points',       m.points,
             'rank_delta',   m.delta
           ) order by m.rnk)
      into v_standings
      from (
        select row_number() over (order by points desc, ord, uid) as rnk, *
          from (
            select s.user_id::text as uid, p.display_name, p.username, p.avatar_url,
                   p.is_pro, s.score as points, 0 as ord, null::int as delta
              from public._live_event_scores(v_event.id, v_enforce) s       -- gate mode
              join public.profiles p on p.id = s.user_id
            union all
            select x.uid, x.display_name, null, null, false, x.points, 1, x.delta
              from (values
                     ('00000000-0000-4000-8000-000000000001', 'Maya K',    1240,  0),
                     ('00000000-0000-4000-8000-000000000002', 'Jordan R',  1105,  2),
                     ('00000000-0000-4000-8000-000000000003', 'Alex T',     990, -1),
                     ('00000000-0000-4000-8000-000000000005', 'Riley P',    760,  1),
                     ('00000000-0000-4000-8000-000000000006', 'Charlie B',  655, -2),
                     ('00000000-0000-4000-8000-000000000007', 'Ash M',      540,  0),
                     ('00000000-0000-4000-8000-000000000008', 'Nova S',     430,  3)
                   ) as x(uid, display_name, points, delta)
          ) u
      ) m;

    select m.rnk, m.points into v_rank, v_points
      from (
        select row_number() over (order by points desc, ord, uid) as rnk, uid, points
          from (
            select s.user_id::text as uid, s.score as points, 0 as ord
              from public._live_event_scores(v_event.id, v_enforce) s       -- gate mode
            union all
            select x.uid, x.points, 1
              from (values
                     ('00000000-0000-4000-8000-000000000001', 1240),
                     ('00000000-0000-4000-8000-000000000002', 1105),
                     ('00000000-0000-4000-8000-000000000003',  990),
                     ('00000000-0000-4000-8000-000000000005',  760),
                     ('00000000-0000-4000-8000-000000000006',  655),
                     ('00000000-0000-4000-8000-000000000007',  540),
                     ('00000000-0000-4000-8000-000000000008',  430)
                   ) as x(uid, points)
          ) u
      ) m
     where m.uid = v_uid::text;

    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   'live',
      'is_locked', false,
      'is_preview', true,
      'standings', coalesce(v_standings, '[]'::jsonb),
      'viewer',   v_viewer || case when v_rank is null then '{}'::jsonb
                    else jsonb_build_object('rank', v_rank, 'points', v_points) end
    );
  end if;

  select jsonb_agg(jsonb_build_object(
           'rank',         r.rank,
           'user_id',      r.user_id,
           'display_name', p.display_name,
           'username',     p.username,
           'avatar_url',   p.avatar_url,
           'is_pro',       p.is_pro,
           'points',       r.score,
           'total_earned', x.total_earned,
           'today_points', x.today_points,
           'rank_delta',   (d.prev_rank - r.rank)::int
         ) order by r.rank)
    into v_standings
    from (
      select * from public._live_event_scores(v_event.id, v_enforce)          -- gate mode
      order by rank
      limit v_event.board_size
    ) r
    join public.profiles p on p.id = r.user_id
    left join public._live_event_rank_deltas(v_event.id) d on d.user_id = r.user_id
    cross join lateral public._live_event_row_extras(v_event.id, r.user_id) x;

  return jsonb_build_object(
    'event_id', v_event.id,
    'status',   v_status,
    'is_locked', false,
    'standings', coalesce(v_standings, '[]'::jsonb),
    'viewer',   v_viewer || coalesce((
      select jsonb_build_object('rank', r.rank, 'points', r.score,
                                'rank_delta', (d.prev_rank - r.rank)::int)
      from public._live_event_scores(v_event.id, v_enforce) r                -- gate mode
      left join public._live_event_rank_deltas(v_event.id) d on d.user_id = r.user_id
      where r.user_id = v_uid
    ), '{}'::jsonb)
  ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
end;
$$;

-- ── 5. Seed + self-check ────────────────────────────────────────────────────
-- First capture happens now so a live event has a baseline the moment this
-- lands. Immediately after, the reference IS this capture, so every scored
-- row must read delta 0 and every scored row must have a reference row —
-- anything else means the two rank sequences disagree.

select public.live_event_snapshot_ranks();

do $$
declare
  r      record;
  v_rows int;
  v_ref  int;
  v_bad  int;
begin
  for r in
    select e.id, e.slug, e.entry_gate_mode
      from public.live_events e
     where e.status = 'live'
       and now() >= e.window_start_at
       and now() <  e.window_end_at
  loop
    select count(*) into v_rows
      from public._live_event_scores(r.id, r.entry_gate_mode = 'entry') s
     where s.score > 0;

    select count(*) into v_ref from public._live_event_rank_deltas(r.id);

    select count(*) into v_bad
      from public._live_event_scores(r.id, r.entry_gate_mode = 'entry') s
      join public._live_event_rank_deltas(r.id) d on d.user_id = s.user_id
     where s.score > 0 and d.prev_rank <> s.rank;

    if v_rows <> v_ref or v_bad > 0 then
      raise exception 'rank snapshot mismatch on %: scored=% reference=% moved=%',
        r.slug, v_rows, v_ref, v_bad;
    end if;
  end loop;
end $$;
