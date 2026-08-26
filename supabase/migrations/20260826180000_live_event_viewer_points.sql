-- =============================================================
-- Live events: the viewer's own points while gated / sealed
-- =============================================================
-- The board payload has one discipline — nothing score-shaped leaves
-- the server unless the viewer has earned the board. That rule exists
-- to protect OTHER people's numbers (the friends-gate, the sealed
-- reveal). It was also hiding the viewer's own running total, so a
-- registrant behind the gate trained all week and the League tab told
-- them nothing back.
--
-- This adds `viewer.points` to the gated and locked payloads for
-- viewers who are actually in the event. Rank stays hidden in both —
-- the rank IS the secret; the points are a number the person watched
-- accrue anyway.
--
-- The number has to be THE event's number: same window, same
-- manual/walking/streak flags, same activity allowlist as the scorer,
-- or the total someone watched all week disagrees with the board the
-- moment it unlocks. So the "counted transactions" predicate moves out
-- of _live_event_scores into one shared function and both read it.

-- ── _live_event_counted — the one definition of "counts for this event"
create or replace function public._live_event_counted(p_event_id uuid, p_uid uuid default null)
returns table (user_id uuid, amount integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select pt.user_id, pt.amount, pt.created_at
  from public.point_transactions pt
  cross join (select * from public.live_events where id = p_event_id) ev
  left join public.activity_sessions s on s.id = pt.session_id
  where (p_uid is null or pt.user_id = p_uid)
    and pt.created_at >= ev.window_start_at
    and pt.created_at <  ev.window_end_at
    and (
      pt.type in ('adjustment', 'penalty')
      or (pt.type = 'streak' and ev.count_streak)
      or (
        pt.type = 'earn'
        and (ev.count_manual  or coalesce(s.verification::text, '') <> 'manual')
        and (ev.count_manual  or coalesce(pt.source, '')            <> 'manual_log')
        and (ev.count_walking or coalesce(s.type::text, '')         <> 'walking')
        and (s.id is null
             or ev.included_activities is null
             or s.type::text = any (ev.included_activities))
      )
    )
$$;

revoke all on function public._live_event_counted(uuid, uuid) from public, anon, authenticated;

-- ── _live_event_user_points — one viewer's total under the event's rules
-- Deliberately ignores eligibility / the gate: it answers "what have
-- you earned this week" for someone who is in the event but not yet on
-- the board. Callers decide who gets to see it.
create or replace function public._live_event_user_points(p_event_id uuid, p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c.amount), 0)::integer
  from public._live_event_counted(p_event_id, p_uid) c
$$;

revoke all on function public._live_event_user_points(uuid, uuid) from public, anon, authenticated;

-- ── _live_event_scores — unchanged output, now reads the shared predicate
create or replace function public._live_event_scores(p_event_id uuid)
returns table (user_id uuid, score integer, last_counted_tx_at timestamptz, rank bigint)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select * from public.live_events where id = p_event_id
  ),
  eligible as (
    select p.id as user_id
    from public.profiles p
    cross join ev
    where p.created_at < coalesce(ev.eligibility_cutoff_at, ev.window_start_at)
      and not exists (
        select 1 from public.live_event_participants lp
        where lp.event_id = ev.id
          and lp.user_id  = p.id
          and lp.disqualified_at is not null
      )
      and (
        (ev.scope = 'global' and p.show_on_leaderboard = true)
        or
        (ev.scope = 'opt_in' and exists (
          select 1 from public.live_event_participants lp
          where lp.event_id = ev.id and lp.user_id = p.id
        ))
      )
      and (
        ev.entry_gate_n <= 0
        or public._live_event_gate_count(ev.id, p.id) >= ev.entry_gate_n
      )
  ),
  counted as (
    select c.user_id, c.amount, c.created_at
    from public._live_event_counted(p_event_id) c
  )
  select
    e.user_id,
    coalesce(sum(c.amount), 0)::integer as score,
    max(c.created_at)                   as last_counted_tx_at,
    rank() over (
      order by coalesce(sum(c.amount), 0) desc,
               max(c.created_at) asc nulls last,
               e.user_id asc
    ) as rank
  from eligible e
  left join counted c on c.user_id = e.user_id
  group by e.user_id
$$;

revoke all on function public._live_event_scores(uuid) from public, anon, authenticated;

-- ── get_event_leaderboard — carry viewer.points through the blurs
-- Identical to the deployed version except three places, each marked
-- `-- viewer.points`: the real gated branch, the scheduled/locked/hidden
-- branch, and the forced-gated preview (real points, so a tester sees
-- their own number the way the room will).
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
  v_viewer := public._live_event_viewer(v_event, v_uid);

  -- viewer.points: the viewer's own total under the event's rules, for
  -- someone who is IN the event (registered, or global-scope eligible)
  -- once the window has opened. Never a rank. Empty object otherwise so
  -- the client's "points present" check is the whole gate.
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
      'viewer',   v_viewer || v_own                                   -- viewer.points
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
      'viewer',   v_viewer || v_own || jsonb_build_object(            -- viewer.points
        'gate', jsonb_build_object(
          'required', v_gate_req,
          'counting', v_event.entry_gate_counting,
          'count',    v_gate_have,
          'met',      false
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
    -- Scheduled, locked or hidden: nothing score-shaped about anyone
    -- else. This is the blur. The viewer's own total rides along.
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_status,
      'is_locked', v_locked,
      'viewer',   v_viewer || v_own                                   -- viewer.points
    ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
  end if;

  if not v_forced
     and v_event.entry_gate_n > 0
     and public._live_event_gate_count(v_event.id, v_uid) < v_event.entry_gate_n then
    -- Live, but this viewer hasn't earned the board yet. No scores for
    -- anyone else, no rank; viewer.gate carries their progress and
    -- viewer.points what they've banked so far.
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_status,
      'is_locked', false,
      'is_gated',  true,
      'viewer',   v_viewer || v_own                                   -- viewer.points
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
