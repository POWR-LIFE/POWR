-- =============================================================
-- LIVE EVENTS — referral entry gate
-- =============================================================
-- "Refer N friends to get on the leaderboard." When
-- entry_gate_n > 0 a user must have N qualifying referrals to
-- appear in the scoring output OR see the live standings — the
-- gate is enforced server-side in both places (client-side blur
-- is readable):
--
--   * _live_event_scores drops non-gate-met users from the
--     eligible set, so standings, the admin through-blur board,
--     the big-screen display and Settle all agree for free.
--   * get_event_leaderboard returns a payload with is_gated:true
--     and nothing score-shaped to a viewer who hasn't met the
--     gate (same shape discipline as the locked blur).
--
-- Deliberate boundaries:
--
--   * JOINING stays open. Registration is the top of the invite
--     funnel (and the surface that routes people to the venue
--     booking) — gating it would strangle the mechanic that
--     feeds it. The gate is about the board, not the guest list.
--   * REVEALED results stay visible to everyone. The reveal is
--     an in-person moment on a public big screen; hiding the
--     winners card from non-gate-met users would only stop them
--     celebrating/sharing it.
--   * The gate is evaluated live, not stamped: someone whose 5th
--     referral lands on Thursday scores their WHOLE window
--     retroactively (scores are always computed from the ledger
--     — same principle as every other knob).
--
-- Counting modes (entry_gate_counting):
--   'signups'     — a referral row exists (the friend entered
--                   this user's code at onboarding). This is the
--                   only download-shaped signal we can attribute:
--                   store installs strip link params, so comms
--                   must push the CODE. Default.
--   'conversions' — the referral converted (friend's first
--                   verified workout). Stricter, unfarmable.
--
-- entry_gate_since bounds which referrals count (null = all —
-- which is effectively campaign-start anyway: the referrals
-- table was empty before the invite engine shipped).
-- =============================================================

alter table public.live_events
  add column if not exists entry_gate_n        integer not null default 0,
  add column if not exists entry_gate_counting text    not null default 'signups',
  add column if not exists entry_gate_since    timestamptz;

alter table public.live_events
  drop constraint if exists live_events_entry_gate_counting_check;
alter table public.live_events
  add constraint live_events_entry_gate_counting_check
    check (entry_gate_counting in ('signups', 'conversions'));

-- The single definition of "how many referrals count toward this
-- event's gate for this user" — called from the scorer, the
-- viewer fragment and invite progress so the numbers can never
-- disagree between surfaces.
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
    and (ev.entry_gate_counting <> 'conversions' or r.converted_at is not null)
$$;

-- Internal: only ever called from inside the definer RPCs.
revoke all on function public._live_event_gate_count(uuid, uuid) from public, anon, authenticated;

-- =============================================================
-- _live_event_scores — eligible now requires the gate
-- =============================================================
-- Unchanged except the entry-gate predicate at the end of the
-- eligible CTE.
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
    select pt.user_id, pt.amount, pt.created_at
    from public.point_transactions pt
    cross join ev
    left join public.activity_sessions s on s.id = pt.session_id
    where pt.created_at >= ev.window_start_at
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

-- =============================================================
-- _live_event_viewer — carries the viewer's gate progress
-- =============================================================
-- `gate` is null when the event has no gate; otherwise the card
-- and the board render progress straight off it. Additive — every
-- existing consumer (get_live_event, join_live_event, preview
-- reset) keeps working untouched.
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
          'required', p_event.entry_gate_n,
          'counting', p_event.entry_gate_counting,
          'count',    g.n,
          'met',      g.n >= p_event.entry_gate_n
        )
        from (select public._live_event_gate_count(p_event.id, p_uid) as n) g
      ) end
  )
$$;

revoke all on function public._live_event_viewer(public.live_events, uuid) from public, anon, authenticated;

-- =============================================================
-- get_event_leaderboard — gate the live standings
-- =============================================================
-- Unchanged except: a viewer who hasn't met an active gate gets
-- is_gated:true and nothing score-shaped while the board is live.
-- Revealed/settled results stay visible to everyone (in-person
-- reveal is public — see header).
create or replace function public.get_event_leaderboard(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_event     public.live_events;
  v_locked    boolean;
  v_standings jsonb;
  v_results   jsonb;
  v_viewer    jsonb;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events
   where id = p_event_id and status not in ('draft', 'archived');
  if not found then
    return null;
  end if;

  v_locked := v_event.status = 'locked'
              or v_event.hidden
              or (v_event.lock_at is not null and now() >= v_event.lock_at);
  v_viewer := public._live_event_viewer(v_event, v_uid);

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

  if v_event.status <> 'live' or v_locked then
    -- Scheduled, locked or hidden: the server returns nothing
    -- score-shaped. This is the blur.
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_event.status,
      'is_locked', v_locked,
      'viewer',   v_viewer
    );
  end if;

  if v_event.entry_gate_n > 0
     and public._live_event_gate_count(v_event.id, v_uid) < v_event.entry_gate_n then
    -- Live, but this viewer hasn't earned the board yet. Same
    -- shape discipline as the locked blur: no scores anywhere in
    -- the payload; viewer.gate carries their progress.
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_event.status,
      'is_locked', false,
      'is_gated',  true,
      'viewer',   v_viewer
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
    'status',   v_event.status,
    'is_locked', false,
    'standings', coalesce(v_standings, '[]'::jsonb),
    'viewer',   v_viewer || coalesce((
      select jsonb_build_object('rank', r.rank, 'points', r.score)
      from public._live_event_scores(v_event.id) r
      where r.user_id = v_uid
    ), '{}'::jsonb)
  );
end;
$$;

-- =============================================================
-- get_my_invite_progress — gate progress rides the event block
-- =============================================================
-- Unchanged except the entry_gate_* keys. gate_met is true when
-- there is no gate, so clients can gate copy on it directly.
create or replace function public.get_my_invite_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_event public.live_events;
  v_friends jsonb;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event
    from public.live_events
   where status in ('scheduled', 'live')
     and now() <= coalesce(conversion_deadline_at, window_end_at)
   order by window_start_at
   limit 1;

  select jsonb_agg(jsonb_build_object(
           'display_name', p.display_name,
           'username',     p.username,
           'avatar_url',   p.avatar_url,
           'converted',    r.converted_at is not null,
           'converted_at', r.converted_at
         ) order by r.created_at desc)
    into v_friends
    from public.referrals r
    join public.profiles p on p.id = r.referred_id
   where r.referrer_id = v_uid;

  return jsonb_build_object(
    'friends',         coalesce(v_friends, '[]'::jsonb),
    'total',           (select count(*) from public.referrals r where r.referrer_id = v_uid),
    'converted_total', (select count(*) from public.referrals r
                         where r.referrer_id = v_uid and r.converted_at is not null),
    'event', case when v_event.id is null then null else jsonb_build_object(
      'event_id',            v_event.id,
      'invite_bonus_points', v_event.invite_bonus_points,
      'milestone_n',         v_event.invite_milestone_n,
      'milestone_bonus',     v_event.invite_milestone_bonus,
      'converted_for_event', (select count(*) from public.referrals r
                               where r.referrer_id = v_uid
                                 and r.event_id = v_event.id
                                 and r.converted_at is not null),
      'milestone_paid',      exists (select 1 from public.live_event_invite_milestones m
                                      where m.event_id = v_event.id and m.referrer_id = v_uid),
      'entry_gate_n',        v_event.entry_gate_n,
      'entry_gate_counting', v_event.entry_gate_counting,
      'gate_count',          public._live_event_gate_count(v_event.id, v_uid),
      'gate_met',            v_event.entry_gate_n <= 0
                             or public._live_event_gate_count(v_event.id, v_uid) >= v_event.entry_gate_n
    ) end
  );
end;
$$;
