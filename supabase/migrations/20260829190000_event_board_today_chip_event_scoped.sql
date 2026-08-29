-- =============================================================
-- Event board "+N TODAY" chip: event-scoped, not wallet-scoped
--
-- 20260829150000 fed the live-event board rows the same today_points the
-- league views use: wallet ledger rows CREDITED since UTC midnight. On an
-- event board that lies twice over — a phone backfilling last week's
-- walking + sleep this afternoon shows "+85 TODAY" beside a score of 54,
-- because the chip counts by credit time and ignores the window entirely
-- (Luke, 08-29: 12 of 13 rows landed in one 15:38Z sync burst, six of
-- them for 22–27 Aug, all correctly EXCLUDED from his score).
--
-- Now the board row's today_points is the event's own arithmetic:
--   sum of _live_event_counted rows whose counted_at (activity END for
--   session-backed rows, credit time for sessionless bonuses and
--   adjustments) falls in the CURRENT SCORING DAY — the event's day grid
--   (window_start_at + n·24h), i.e. London midnight for FNL, so "today"
--   on the board means the same day the scoring window means.
-- By construction the chip is a subset of the score: everything it counts
-- is in the score, and anything outside the window (or switched off by
-- the count_* toggles) never appears. Join date is irrelevant, as it is
-- for the score itself.
--
-- The league views keep the wallet definition (LEAGUE_LIVE=false, dormant).
-- total_earned (level basis) is unchanged. No client change: same keys.
-- =============================================================

-- ── 1. Event-scoped row extras ───────────────────────────────────────────────

create or replace function public._live_event_row_extras(p_event_id uuid, p_user_id uuid)
returns table (total_earned int, today_points int)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select window_start_at from public.live_events where id = p_event_id
  ),
  day as (
    -- current scoring day on the event's own day grid; before the window
    -- opens the grid's first day applies (nothing is counted then anyway).
    select ev.window_start_at
           + greatest(floor(extract(epoch from (now() - ev.window_start_at)) / 86400), 0) * interval '1 day'
           as start_at
    from ev
  )
  select
    (select x.total_earned from public._leaderboard_row_extras(p_user_id) x) as total_earned,
    coalesce((
      select sum(c.amount)
      from public._live_event_counted(p_event_id, p_user_id) c, day
      where c.created_at >= day.start_at
        and c.created_at <  day.start_at + interval '1 day'
    ), 0)::int as today_points;
$$;

revoke execute on function public._live_event_row_extras(uuid, uuid) from public, anon, authenticated;
grant execute on function public._live_event_row_extras(uuid, uuid) to service_role;

-- ── 2. get_event_leaderboard — real rows use the event-scoped extras ─────────
-- Body identical to 20260829150000 (verified against the prod definition
-- before this migration was written) except the two real-row joins.
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
             'points',       m.points
           ) order by m.rnk)
      into v_standings
      from (
        select row_number() over (order by points desc, ord, uid) as rnk, *
          from (
            select s.user_id::text as uid, p.display_name, p.username, p.avatar_url,
                   p.is_pro, s.score as points, 0 as ord
              from public._live_event_scores(v_event.id, v_enforce) s       -- gate mode
              join public.profiles p on p.id = s.user_id
            union all
            select x.uid, x.display_name, null, null, false, x.points, 1
              from (values
                     ('00000000-0000-4000-8000-000000000001', 'Maya K',    1240),
                     ('00000000-0000-4000-8000-000000000002', 'Jordan R',  1105),
                     ('00000000-0000-4000-8000-000000000003', 'Alex T',     990),
                     ('00000000-0000-4000-8000-000000000005', 'Riley P',    760),
                     ('00000000-0000-4000-8000-000000000006', 'Charlie B',  655),
                     ('00000000-0000-4000-8000-000000000007', 'Ash M',      540),
                     ('00000000-0000-4000-8000-000000000008', 'Nova S',     430)
                   ) as x(uid, display_name, points)
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
           'today_points', x.today_points
         ) order by r.rank)
    into v_standings
    from (
      select * from public._live_event_scores(v_event.id, v_enforce)          -- gate mode
      order by rank
      limit v_event.board_size
    ) r
    join public.profiles p on p.id = r.user_id
    cross join lateral public._live_event_row_extras(v_event.id, r.user_id) x;

  return jsonb_build_object(
    'event_id', v_event.id,
    'status',   v_status,
    'is_locked', false,
    'standings', coalesce(v_standings, '[]'::jsonb),
    'viewer',   v_viewer || coalesce((
      select jsonb_build_object('rank', r.rank, 'points', r.score)
      from public._live_event_scores(v_event.id, v_enforce) r                -- gate mode
      where r.user_id = v_uid
    ), '{}'::jsonb)
  ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
end;
$$;

-- ── 3. Self-check: the chip can never exceed the score ────────────────────
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.live_events ev
  cross join lateral public._live_event_scores(ev.id, false) s
  cross join lateral public._live_event_row_extras(ev.id, s.user_id) x
  where ev.status <> 'archived'
    and x.today_points > s.score;
  if v_bad > 0 then
    raise exception 'event board today chip exceeds score for % rows', v_bad;
  end if;
end $$;
