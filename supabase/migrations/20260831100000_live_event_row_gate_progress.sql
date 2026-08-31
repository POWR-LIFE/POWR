-- =============================================================
-- Live event board: referral-gate progress on every row (3/3, 6/3)
--
-- Jamie (08-31): "we arent showing who has completed their referrals, a
-- simple 3/3 or 6/3 etc for each user which we should have in place as
-- its another cue for users to complete this as a task."
--
-- In deadline gate mode the live board shows everyone registered, but
-- anyone under the requirement is dropped at Settle — and nothing on the
-- board said who was safe. Each live standings row now carries
--   gate_count = _live_event_gate_count(event, user)   (uncapped: 6/3 shows)
-- present only when the event has a gate (entry_gate_n > 0), else null.
-- The client renders it against viewer.gate.required — the required side
-- already rides every viewer payload whenever a gate exists.
--
-- Deliberately NOT on revealed/settled results rows: Settle enforces the
-- gate, so every surviving row would read "met" — noise, not a cue.
-- Preview theatre rows carry fixed sample counts (nulled when the draft
-- has no gate) so an admin walkthrough shows the chip.
--
-- Body of get_event_leaderboard = 20260830150000 (prod md5 verified
-- 17fb66a1… before this was written) + the gate_count splices.
-- =============================================================

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
             'rank_delta',   m.delta,
             'gate_count',   m.gate_count
           ) order by m.rnk)
      into v_standings
      from (
        select row_number() over (order by points desc, ord, uid) as rnk, *
          from (
            select s.user_id::text as uid, p.display_name, p.username, p.avatar_url,
                   p.is_pro, s.score as points, 0 as ord, null::int as delta,
                   case when v_event.entry_gate_n > 0
                        then public._live_event_gate_count(v_event.id, s.user_id) end as gate_count
              from public._live_event_scores(v_event.id, v_enforce) s       -- gate mode
              join public.profiles p on p.id = s.user_id
            union all
            select x.uid, x.display_name, null, null, false, x.points, 1, x.delta,
                   case when v_event.entry_gate_n > 0 then x.gate end
              from (values
                     ('00000000-0000-4000-8000-000000000001', 'Maya K',    1240,  0, 3),
                     ('00000000-0000-4000-8000-000000000002', 'Jordan R',  1105,  2, 4),
                     ('00000000-0000-4000-8000-000000000003', 'Alex T',     990, -1, 2),
                     ('00000000-0000-4000-8000-000000000005', 'Riley P',    760,  1, 3),
                     ('00000000-0000-4000-8000-000000000006', 'Charlie B',  655, -2, 1),
                     ('00000000-0000-4000-8000-000000000007', 'Ash M',      540,  0, 0),
                     ('00000000-0000-4000-8000-000000000008', 'Nova S',     430,  3, 5)
                   ) as x(uid, display_name, points, delta, gate)
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
           'rank_delta',   (d.prev_rank - r.rank)::int,
           'gate_count',   g.gate_count
         ) order by r.rank)
    into v_standings
    from (
      select * from public._live_event_scores(v_event.id, v_enforce)          -- gate mode
      order by rank
      limit v_event.board_size
    ) r
    join public.profiles p on p.id = r.user_id
    left join public._live_event_rank_deltas(v_event.id) d on d.user_id = r.user_id
    cross join lateral public._live_event_row_extras(v_event.id, r.user_id) x
    left join lateral (
      select case when v_event.entry_gate_n > 0
                  then public._live_event_gate_count(v_event.id, r.user_id) end as gate_count
    ) g on true;

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
