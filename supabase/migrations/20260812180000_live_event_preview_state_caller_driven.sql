-- =============================================================
-- LIVE EVENTS — testers drive the board preview themselves
-- =============================================================
-- 20260812160000 gave the board four preview states, but left them
-- unwalkable as a FLOW. Three things stopped a tester seeing the whole
-- lifecycle:
--
--   1. preview_board_state is one column on the event, set in admin and
--      shared by every tester. Walking sealed → live → winners meant an
--      admin flipping a column between each step, and every other tester
--      got yanked to whatever state was set last.
--
--   2. There is no 'gated' state, so the friends-blur — the entire
--      mechanic of a gated event — was reachable only on an event that
--      HAS a gate, by a tester who hasn't met it. On an event with
--      entry_gate_n = 0 it could not be seen at all, and
--      _live_event_viewer returns gate = null there, so the client's
--      gated card (which needs viewer.gate) could never render.
--
--   3. The real gate check ran BEFORE the forced-state branches, so on a
--      gated event a forced 'live' was silently swallowed: the tester
--      asked for the live board and got the blur. The forced state
--      appeared to do nothing, with no signal as to why.
--
-- This makes the state a CALLER argument. p_preview_state is honoured
-- only for a previewer on a draft — the exact same door as the rest of
-- the preview mechanic — and falls back to the event's column when the
-- caller doesn't pass one, so the admin control keeps working as the
-- default. Per-caller, so two testers can sit on different states at the
-- same time, and nothing is written to walk the flow.
--
-- Real events remain byte-for-byte untouched: outside a draft+previewer
-- the argument is ignored entirely and v_state is pinned to 'auto'.
-- =============================================================

alter table public.live_events
  drop constraint if exists live_events_preview_board_state_check;
alter table public.live_events
  add constraint live_events_preview_board_state_check
    check (preview_board_state in ('auto', 'gated', 'live', 'locked', 'revealed'));

-- The 1-arg version is dropped and replaced by a 2-arg one with a
-- DEFAULT, so existing clients calling get_event_leaderboard(p_event_id)
-- keep resolving to it unchanged.
drop function if exists public.get_event_leaderboard(uuid);

create or replace function public.get_event_leaderboard(
  p_event_id      uuid,
  p_preview_state text default null
)
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
  v_standings jsonb;
  v_results   jsonb;
  v_viewer    jsonb;
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

  -- Effective state. The caller's choice wins for a previewer, the event's
  -- admin-set column is the fallback, and a non-previewer is pinned to
  -- 'auto' no matter what they send. An unrecognised value is ignored
  -- rather than erroring, so a stale client can never break the board.
  v_state := case
    when not v_preview then 'auto'
    when p_preview_state in ('auto', 'gated', 'live', 'locked', 'revealed')
      then p_preview_state
    else v_event.preview_board_state
  end;
  v_forced := v_preview and v_state <> 'auto';

  -- Previewers see the draft as it would behave once launched.
  v_status := case
    when not v_preview then v_event.status
    when now() >= v_event.window_start_at and now() < v_event.window_end_at then 'live'
    else 'scheduled'
  end;

  v_locked := v_event.status = 'locked'
              or v_event.hidden
              or (v_event.lock_at is not null and now() >= v_event.lock_at);
  v_viewer := public._live_event_viewer(v_event, v_uid);

  -- ── Forced preview states (draft + previewer only) ──────────
  if v_forced and v_state = 'locked' then
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   'live',
      'is_locked', true,
      'is_preview', true,
      'viewer',   v_viewer
    );
  end if;

  -- The friends-blur. viewer.gate is synthesised because the client needs
  -- it to render the card at all, and an event with entry_gate_n = 0 has
  -- no real gate to report. Held one short of the requirement so it always
  -- reads as unmet — a met gate is not a blur, it's just the board.
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
      'viewer',   v_viewer || jsonb_build_object(
        'gate', jsonb_build_object(
          'required', v_gate_req,
          'counting', v_event.entry_gate_counting,
          'count',    v_gate_have,
          'met',      false
        ))
    );
  end if;

  if v_forced and v_state = 'revealed' then
    -- Sample winners snapshot: seven fixed rows + the viewer at rank 4
    -- with their real identity, prize labels from the event's own config.
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

  -- ── Real lifecycle (status simulated for previewers) ────────
  if v_event.status in ('revealed', 'settled') then
    select jsonb_agg(jsonb_build_object(
             'rank',         r.rank,
             'user_id',      r.user_id,
             'display_name', p.display_name,
             'username',     p.username,
             'avatar_url',   p.avatar_url,
             'is_pro',       p.is_pro,
             'points',       r.final_points,
             'prize_label',  r.prize_label
           ) order by r.rank)
      into v_results
      from public.live_event_results r
      join public.profiles p on p.id = r.user_id
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
    -- Scheduled, locked or hidden: the server returns nothing
    -- score-shaped. This is the blur.
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_status,
      'is_locked', v_locked,
      'viewer',   v_viewer
    ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
  end if;

  -- The real entry gate. Deliberately skipped when a state was FORCED:
  -- a tester who asked for the live board must get the live board, not
  -- the blur. Unforced ('auto') previewers still meet the real gate,
  -- because 'auto' means "behave exactly like the real thing".
  if not v_forced
     and v_event.entry_gate_n > 0
     and public._live_event_gate_count(v_event.id, v_uid) < v_event.entry_gate_n then
    -- Live, but this viewer hasn't earned the board yet. Same
    -- shape discipline as the locked blur: no scores anywhere in
    -- the payload; viewer.gate carries their progress.
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_status,
      'is_locked', false,
      'is_gated',  true,
      'viewer',   v_viewer
    ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
  end if;

  if v_forced and v_state = 'live' then
    -- Real preview scores merged with sample rows, re-ranked together, so
    -- the design is judged on a full board.
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
              from public._live_event_scores(v_event.id) s
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
              from public._live_event_scores(v_event.id) s
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
           'points',       r.score
         ) order by r.rank)
    into v_standings
    from (
      select * from public._live_event_scores(v_event.id)
      order by rank
      limit v_event.board_size
    ) r
    join public.profiles p on p.id = r.user_id;

  return jsonb_build_object(
    'event_id', v_event.id,
    'status',   v_status,
    'is_locked', false,
    'standings', coalesce(v_standings, '[]'::jsonb),
    'viewer',   v_viewer || coalesce((
      select jsonb_build_object('rank', r.rank, 'points', r.score)
      from public._live_event_scores(v_event.id) r
      where r.user_id = v_uid
    ), '{}'::jsonb)
  ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
end;
$$;

grant execute on function public.get_event_leaderboard(uuid, text) to authenticated, anon, service_role;
