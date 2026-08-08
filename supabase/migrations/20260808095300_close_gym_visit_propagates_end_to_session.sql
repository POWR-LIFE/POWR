-- The exit close used to stamp gym_visits.ended_at and stop there, leaving
-- activity_sessions holding whatever the last presence pass happened to write.
--
-- Field 2026-08-08, two phones, one gym, ground-truth exit 09:43:08:
--   iOS      session ended 09:36:02 (3119 s = 52.0 min)  visit closed 09:41:03  →  7 min short
--   Android  session ended 09:22:43 (2400 s = 40.0 min)  never closed at all    → 20 min short
-- The completion push told the user "52 min" for a 59-minute session.
--
-- That is the same class of error PR #365 set out to end. #365 made
-- activity_sessions authoritative on the grounds that the visit undercounts —
-- but the session undercounted by MORE, because nothing ever carried the exit
-- instant into it. Its accuracy was bounded by presence-pass cadence rather
-- than by the exit that actually ended the session.
--
-- NEVER SHRINK. gymReconcile legitimately extends a session against the health
-- store (a warm-up the fence never saw), so this only ever grows the row —
-- greatest() on both columns. The 12 h clamp mirrors MAX_GYM_SESSION_SEC and is
-- a backstop against a wild ended_at, not a duration model.
--
-- close_gym_visit_by_ticket delegates here, so the background wake-ticket path
-- is covered by the same change.
create or replace function public.close_gym_visit(
  p_visit_id uuid,
  p_ended_at timestamp with time zone default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user     uuid := auth.uid();
  v_ended_at timestamptz := coalesce(p_ended_at, now());
  v_session  uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

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
    values (p_visit_id, v_user, 'exit', jsonb_build_object('ended_at', v_ended_at));

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
