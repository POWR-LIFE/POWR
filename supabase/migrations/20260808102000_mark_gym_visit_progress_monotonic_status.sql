-- Visit status must only ever move FORWARD: open → claimed → upgraded → closed.
--
-- It used to be `set status = p_stage` unconditionally, so any late or replayed
-- progress call rewrote it. Field 2026-08-08, 09:41:03: the #364 presence pass
-- deliberately sends `stage:'dwell'` on the wire ("what the client task already
-- understands"), the client took it literally, re-ran the dwell claim, and an
-- UPGRADED visit went back to 'claimed'. `upgraded_at` survived — so the reaper,
-- which gates on it, still worked — but the status was simply wrong.
--
-- The oscillation risk is the real cost: a visit sitting at 'claimed' past the
-- upgrade threshold is exactly what the beacon's upgrade pass looks for, so it
-- re-nudges, upgrade-gym-tier answers "Already at max tier", markVisitUpgraded
-- pushes it back to 'upgraded', and the next presence pass knocks it down again
-- — a push loop on a visit that has nothing left to earn.
--
-- Worse, and not observed only because the ordering did not arise: a 'claimed'
-- arriving after the exit would have REOPENED a closed visit.
--
-- Timestamps keep their coalesce semantics, so a genuinely late 'upgraded' still
-- records upgraded_at even when the status is already 'closed' — the stamp is
-- history, the status is state. last_confirmed_at still moves on every call: the
-- device did answer, and the reaper needs to know that.
create or replace function public.mark_gym_visit_progress(
  p_visit_id uuid,
  p_stage text,
  p_session_id uuid default null::uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_stage not in ('claimed','upgraded') then raise exception 'bad stage'; end if;

  update gym_visits
     set status             = case
                                when p_stage = 'claimed'  and status = 'open'                 then 'claimed'
                                when p_stage = 'upgraded' and status in ('open','claimed')     then 'upgraded'
                                else status
                              end,
         claimed_session_id = coalesce(p_session_id, claimed_session_id),
         claimed_at         = case when p_stage = 'claimed'  then coalesce(claimed_at, now())  else claimed_at end,
         upgraded_at        = case when p_stage = 'upgraded' then coalesce(upgraded_at, now()) else upgraded_at end,
         last_confirmed_at  = now()
   where id = p_visit_id and user_id = v_user;

  if not found then raise exception 'visit not found'; end if;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user, p_stage, jsonb_build_object('session_id', p_session_id));
end;
$function$;
