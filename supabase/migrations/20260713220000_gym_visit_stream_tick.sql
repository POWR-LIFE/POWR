-- Diagnostic heartbeat for the in-gym location stream.
--
-- WHY: the dwell state machine is time-based but only ever runs FROM a location
-- callback, so "did the background location stream actually tick?" is THE question
-- behind every background-claim failure — and today it is unanswerable from the
-- server. gym_visits.last_confirmed_at can't stand in for it: that field means
-- location-PROVEN presence (it bounds a late-reported exit), and indoor fixes are
-- routinely too coarse to prove anything. Overloading it would corrupt the trust
-- model to buy a debug signal.
--
-- So this records a SEPARATE, weaker fact: the stream delivered a fix to JS. It
-- deliberately does NOT touch last_confirmed_at, claimed_at or status, and it can
-- never credit anything — exactly like the rest of the beacon surface.
create or replace function public.log_gym_visit_tick(
  p_visit_id uuid,
  p_detail   jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  -- Owner-locked: a caller can only tick a visit that is theirs and still open.
  if not exists (
    select 1 from gym_visits
     where id = p_visit_id and user_id = v_user and ended_at is null
  ) then
    return; -- stale visit on the device; nothing to record, and nothing to leak.
  end if;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user, 'stream_tick', coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- Definer RPC: grant to the role that actually calls it, never PUBLIC.
revoke all on function public.log_gym_visit_tick(uuid, jsonb) from public;
grant execute on function public.log_gym_visit_tick(uuid, jsonb) to authenticated;
