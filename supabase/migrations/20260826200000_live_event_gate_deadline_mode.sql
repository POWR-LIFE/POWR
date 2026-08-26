-- =============================================================
-- Live events: the invite requirement as a DEADLINE, not a door
-- =============================================================
-- Jamie 2026-08-26: "let people onto the leaderboard regardless of
-- their referral count when the event opens, as long as they complete
-- the referral count by the end of the event."
--
-- The gate used to be a door: below N friends you were neither scored
-- nor shown the board. With a small cohort that is a wall, not a
-- multiplier — every FNL registrant sat at 0/3, so Settle would have
-- produced an empty results table and the venue screen an empty board.
--
-- `entry_gate_mode`:
--   'deadline' (new default) — everyone registered is scored and sees
--       the live board from the moment the window opens. The count is
--       a condition to KEEP your place: Settle (and only Settle) drops
--       anyone below N. Friends must be in by the gate deadline =
--       conversion_deadline_at, else lock_at, else window_end_at.
--   'entry' — the previous behaviour, kept for events that want the
--       hard door (and for the preview walkthrough's 'gated' state).
--
-- Mechanically: _live_event_scores grows a p_enforce_gate flag
-- (default TRUE, so settle / anticheat / ops keep the final semantics
-- unchanged); the live board and the venue screen pass FALSE in
-- deadline mode. _live_event_gate_count gains the upper bound so a
-- friend who signs up after the deadline never counts, in either mode.

alter table public.live_events
  add column if not exists entry_gate_mode text not null default 'deadline'
  check (entry_gate_mode in ('entry', 'deadline'));

comment on column public.live_events.entry_gate_mode is
  'deadline: everyone registered is on the live board, the invite count must be met by the gate deadline to stay in the FINAL standings (applied at Settle). entry: must meet the count before being scored or shown the board.';

-- ── The one definition of "friends must be in by"
create or replace function public._live_event_gate_deadline(p_event public.live_events)
returns timestamptz
language sql
immutable
as $$
  select coalesce(p_event.conversion_deadline_at, p_event.lock_at, p_event.window_end_at)
$$;

-- ── _live_event_gate_count — now bounded above by the deadline
create or replace function public._live_event_gate_count(p_event_id uuid, p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.referrals r
  cross join public.live_events ev
  where ev.id = p_event_id
    and r.referrer_id = p_uid
    and (ev.entry_gate_since is null or r.created_at >= ev.entry_gate_since)
    and case
          when ev.entry_gate_counting = 'conversions'
            then r.converted_at is not null
             and r.converted_at < public._live_event_gate_deadline(ev)
          else r.created_at < public._live_event_gate_deadline(ev)
        end
$$;

revoke all on function public._live_event_gate_count(uuid, uuid) from public, anon, authenticated;

-- ── _live_event_scores(p_event_id, p_enforce_gate)
-- Default TRUE = final semantics; every existing caller keeps its
-- meaning. Overloads would make the 1-arg call ambiguous, so the old
-- signature goes.
drop function if exists public._live_event_scores(uuid);

create function public._live_event_scores(p_event_id uuid, p_enforce_gate boolean default true)
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
        not p_enforce_gate
        or ev.entry_gate_n <= 0
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

revoke all on function public._live_event_scores(uuid, boolean) from public, anon, authenticated;
-- The venue screen (event-board edge fn) reads it with the service key.
grant execute on function public._live_event_scores(uuid, boolean) to service_role;

-- ── _live_event_viewer — gate carries its mode and deadline
-- Additive: the client keys copy on `mode` and names `deadline_at`.
create or replace function public._live_event_viewer(p_event public.live_events, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'eligible',
      exists (
        select 1 from public.profiles p
        where p.id = p_uid
          and p.created_at < coalesce(p_event.eligibility_cutoff_at, p_event.window_start_at)
          and (p_event.scope <> 'global' or p.show_on_leaderboard = true)
      )
      and not exists (
        select 1 from public.live_event_participants lp
        where lp.event_id = p_event.id and lp.user_id = p_uid
          and lp.disqualified_at is not null
      ),
    'joined',
      exists (
        select 1 from public.live_event_participants lp
        where lp.event_id = p_event.id and lp.user_id = p_uid
          and lp.disqualified_at is null
      ),
    'disqualified',
      exists (
        select 1 from public.live_event_participants lp
        where lp.event_id = p_event.id and lp.user_id = p_uid
          and lp.disqualified_at is not null
      ),
    'gate',
      case when p_event.entry_gate_n <= 0 then null else (
        select jsonb_build_object(
          'required',    p_event.entry_gate_n,
          'counting',    p_event.entry_gate_counting,
          'count',       g.n,
          'met',         g.n >= p_event.entry_gate_n,
          'mode',        p_event.entry_gate_mode,
          'deadline_at', public._live_event_gate_deadline(p_event)
        )
        from (select public._live_event_gate_count(p_event.id, p_uid) as n) g
      ) end,
    'booking',
      jsonb_build_object(
        'opened_at',
          (select lp.booking_link_opened_at
             from public.live_event_participants lp
            where lp.event_id = p_event.id and lp.user_id = p_uid
              and lp.disqualified_at is null),
        'confirmed',
          exists (
            select 1
              from public.live_event_bookings b
              join auth.users u on u.id = p_uid
             where b.event_id = p_event.id
               and b.email = lower(u.email)
          )
      )
  )
$$;

revoke all on function public._live_event_viewer(public.live_events, uuid) from public, anon, authenticated;

-- ── get_event_leaderboard — the door only closes in 'entry' mode
-- Identical to 20260826180000 except the lines marked `-- gate mode`.
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
           'points',       r.score
         ) order by r.rank)
    into v_standings
    from (
      select * from public._live_event_scores(v_event.id, v_enforce)          -- gate mode
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
      from public._live_event_scores(v_event.id, v_enforce) r                -- gate mode
      where r.user_id = v_uid
    ), '{}'::jsonb)
  ) || case when v_preview then jsonb_build_object('is_preview', true) else '{}'::jsonb end;
end;
$$;

-- ── admin_get_event_leaderboard — the ops view shows who Settle would drop
-- In deadline mode the live standings are unenforced (what the room
-- sees) and every row carries gate_count / gate_met so the admin can
-- see who is about to fall out. Entry mode is unchanged.
create or replace function public.admin_get_event_leaderboard(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_rows  jsonb;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  select jsonb_agg(jsonb_build_object(
           'rank',               r.rank,
           'user_id',            r.user_id,
           'display_name',       p.display_name,
           'username',           p.username,
           'avatar_url',         p.avatar_url,
           'is_pro',             p.is_pro,
           'points',             r.score,
           'last_counted_tx_at', r.last_counted_tx_at,
           'sessions_in_window', coalesce(st.total, 0),
           'geofence_sessions',  coalesce(st.geofence, 0),
           'wearable_sessions',  coalesce(st.wearable, 0),
           'manual_sessions',    coalesce(st.manual, 0),
           'flagged_sessions',   coalesce(st.flagged, 0),
           'disqualified',       (lp.disqualified_at is not null),
           'gate_count',         g.n,
           'gate_met',           (v_event.entry_gate_n <= 0 or g.n >= v_event.entry_gate_n)
         ) order by r.rank)
    into v_rows
    from (
      select * from public._live_event_scores(v_event.id, v_event.entry_gate_mode = 'entry')
      where score <> 0
      order by rank
      limit 500
    ) r
    join public.profiles p on p.id = r.user_id
    left join public.live_event_participants lp
           on lp.event_id = v_event.id and lp.user_id = r.user_id
    left join lateral (select public._live_event_gate_count(v_event.id, r.user_id) as n) g on true
    left join lateral (
      select count(*)                                                          as total,
             count(*) filter (where s.verification = 'geofence')               as geofence,
             count(*) filter (where s.verification in ('wearable', 'health'))  as wearable,
             count(*) filter (where s.verification = 'manual')                 as manual,
             count(*) filter (where s.flagged)                                 as flagged
      from public.activity_sessions s
      where s.user_id = r.user_id
        and s.started_at >= v_event.window_start_at
        and s.started_at <  v_event.window_end_at
    ) st on true;

  return jsonb_build_object(
    'event_id',        v_event.id,
    'status',          v_event.status,
    'hidden',          v_event.hidden,
    'entry_gate_mode', v_event.entry_gate_mode,
    'entry_gate_n',    v_event.entry_gate_n,
    'gate_deadline_at', public._live_event_gate_deadline(v_event),
    'standings',       coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;
