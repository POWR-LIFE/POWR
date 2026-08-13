-- NEVER-INFLATE exit close (2026-08-13, mirrors _shared/gymReaper.ts).
--
-- The recorded end of a visit is the last moment presence was actually
-- established — the check-in itself, the credit gates, or a proven tick —
-- never the moment the exit happened to be DETECTED. Field 2026-08-13 AM:
-- an Android exit stamped detection time (09:48) while the last proven tick
-- was 09:22 — ~15 phantom minutes billed to the session. A clamped close can
-- still under-report by one tick interval; it can no longer inflate.
-- close_gym_visit_by_ticket delegates here, so both auth legs get the clamp.

create or replace function public.close_gym_visit(p_visit_id uuid, p_ended_at timestamp with time zone default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user     uuid := auth.uid();
  v_ended_at timestamptz := least(coalesce(p_ended_at, now()), now());
  v_visit    gym_visits%rowtype;
  v_anchor   timestamptz;
  v_session  uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_visit
    from gym_visits
   where id = p_visit_id and user_id = v_user and ended_at is null;
  if not found then return; end if;

  -- Last PROVEN moment: same anchors as staleVisitVerdict. claimed_at /
  -- upgraded_at each required a location-confirmed wake (or a server settle,
  -- whose known cost is documented in gym-visit-beacon's SETTLE pass).
  v_anchor := greatest(
    v_visit.started_at,
    coalesce(v_visit.last_proven_at, v_visit.started_at),
    coalesce(v_visit.claimed_at,     v_visit.started_at),
    coalesce(v_visit.upgraded_at,    v_visit.started_at)
  );
  v_ended_at := greatest(v_visit.started_at, least(v_ended_at, v_anchor));

  update gym_visits
     set ended_at     = v_ended_at,
         status       = 'closed',
         close_reason = 'exit'
   where id = p_visit_id and user_id = v_user and ended_at is null
  returning claimed_session_id into v_session;

  -- Only the call that actually closed the visit logs the exit. A loser in a
  -- concurrent burst is a silent no-op, not a second `exit` row (31 were logged
  -- in 1.4 s on visit 54b70cb6; 30 of them were phantom).
  if found then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (p_visit_id, v_user, 'exit', jsonb_build_object('ended_at', v_ended_at, 'requested_ended_at', p_ended_at, 'clamped', (p_ended_at is not null and v_ended_at < p_ended_at)));

    -- Carry the exit into the row every user-facing surface renders.
    if v_session is not null then
      update activity_sessions
         set ended_at     = greatest(coalesce(ended_at, v_ended_at), v_ended_at),
             duration_sec = least(
               43200,
               greatest(
                 coalesce(duration_sec, 0),
                 extract(epoch from (
                   greatest(coalesce(ended_at, v_ended_at), v_ended_at) - started_at
                 ))::int
               )
             )
       where id = v_session
         and user_id = v_user
         and type = 'gym';
    end if;
  end if;
end;
$function$;
