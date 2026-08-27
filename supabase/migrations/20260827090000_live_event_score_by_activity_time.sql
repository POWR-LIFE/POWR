-- Live events: score by ACTIVITY time, not credit time.
--
-- Incident 2026-08-27 (FNL x POWR, day 1): a brand-new signup connected
-- Apple Health at 07:22Z; the history backfill credited 12 sessions dated
-- 21–26 Aug plus 7 walking days, and those credits unlocked four weekly
-- challenges (incl. "All Four" +85). Every one of the 295 points was
-- CREDITED inside the scoring window but EARNED before it. The predicate
-- bucketed on point_transactions.created_at (when the points landed), so
-- the backfill went straight to #1 with zero in-window activity.
--
-- New rule (one predicate, shared by the scorer, viewer.points, settle,
-- anticheat and the admin standings):
--   • Session-backed rows count when the ACTIVITY overlaps the window
--     (ended_at > window_start AND started_at < window_end) — a sleep that
--     crosses into the window counts, yesterday's run synced this morning
--     does not. Overlap, not started_at, so the last evening of the window
--     is not lost to a session that finishes after the boundary.
--   • Sessionless earn/streak rows (weekly/shared challenge bonuses,
--     streak bonuses) count only once the user has an in-window,
--     session-backed row credited at or before them — bonuses ride on
--     activity, and a bonus unlocked purely by pre-window backfill has
--     nothing to ride on. Adjustments/penalties stay on created_at (they
--     are admin actions, not activity).
-- Tie-break time (returned as created_at for compatibility) is the
-- activity end for sessions, credit time for the rest.

create or replace function public._live_event_counted(p_event_id uuid, p_uid uuid default null)
returns table (user_id uuid, amount integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select * from public.live_events where id = p_event_id
  ),
  rows as (
    select pt.user_id, pt.amount, pt.type, pt.source, pt.created_at,
           s.id                              as session_id,
           s.type::text                      as s_type,
           s.verification::text              as s_verif,
           s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at
    from public.point_transactions pt
    left join public.activity_sessions s on s.id = pt.session_id
    where (p_uid is null or pt.user_id = p_uid)
  ),
  sess as (
    -- session-backed: in the window when the ACTIVITY overlaps it
    select r.user_id, r.amount, r.ended_at as counted_at, r.created_at
    from rows r
    cross join ev
    where r.session_id is not null
      and r.ended_at   >  ev.window_start_at
      and r.started_at <  ev.window_end_at
      and (
        (r.type = 'streak' and ev.count_streak)
        or (
          r.type = 'earn'
          and (ev.count_manual  or coalesce(r.s_verif, '') <> 'manual')
          and (ev.count_manual  or coalesce(r.source, '')  <> 'manual_log')
          and (ev.count_walking or coalesce(r.s_type, '')  <> 'walking')
          and (ev.included_activities is null
               or r.s_type = any (ev.included_activities))
        )
      )
  ),
  other as (
    -- sessionless: credited in the window, and (for bonuses) anchored to
    -- in-window activity the user had already banked
    select r.user_id, r.amount, r.created_at as counted_at
    from rows r
    cross join ev
    where r.session_id is null
      and r.created_at >= ev.window_start_at
      and r.created_at <  ev.window_end_at
      and (
        r.type in ('adjustment', 'penalty')
        or (
          (r.type = 'earn' or (r.type = 'streak' and ev.count_streak))
          and exists (
            select 1 from sess x
            where x.user_id = r.user_id and x.created_at <= r.created_at
          )
        )
      )
  )
  select user_id, amount, counted_at from sess
  union all
  select user_id, amount, counted_at from other
$$;

revoke all on function public._live_event_counted(uuid, uuid) from public, anon, authenticated;

-- ── admin standings: session counts on the same overlap rule as the scorer
-- (previously started_at-bucketed, so the ops panel could show a user with
-- 295 pts and 0 sessions in window).
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
        and coalesce(s.ended_at, s.started_at) > v_event.window_start_at
        and s.started_at                       < v_event.window_end_at
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
