-- mark_gym_visit_progress: a replayed mark is a no-op, and a closed visit takes no stamp.
--
-- Field 2026-11-13, visit 49c07ab3 (iOS): the claim landed by relay at 07:39:03,
-- the visit closed on an exit at 07:44:01, and then the client's own late
-- mark_gym_visit_progress('claimed') ran TWICE (07:44:02, 07:44:04). Each call:
--   • logged another `claimed` event — three claims on the timeline for one
--     session, two of them after the visit had ended; and
--   • stamped last_confirmed_at = now() on a CLOSED visit, so the row claimed a
--     confirmation 3 s after its own end.
--
-- The UPDATE already refused to move status on an ended row; it just did not
-- refuse anything else. Now:
--   • last_confirmed_at moves only while the visit is open (confirm_gym_visit
--     has had the same `ended_at is null` rule since 20260813140000);
--   • the event is logged only when this call actually advanced the visit — a
--     stamp it set (claimed_at / upgraded_at were null) or a session id it
--     newly attached. A repeat of a mark that already landed writes nothing.
--
-- Signature and return type unchanged, so every shipped client keeps working.

create or replace function public.mark_gym_visit_progress(
  p_visit_id uuid,
  p_stage text,
  p_session_id uuid default null::uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user      uuid := auth.uid();
  v_prev      gym_visits%rowtype;
  v_advanced  boolean;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_stage not in ('claimed','upgraded') then raise exception 'bad stage'; end if;

  select * into v_prev
    from gym_visits
   where id = p_visit_id and user_id = v_user
   for update;

  if not found then raise exception 'visit not found'; end if;

  update gym_visits
     set status             = case
                                when ended_at is not null                                     then status
                                when p_stage = 'claimed'  and status = 'open'                 then 'claimed'
                                when p_stage = 'upgraded' and status in ('open','claimed')     then 'upgraded'
                                else status
                              end,
         claimed_session_id = coalesce(p_session_id, claimed_session_id),
         -- An upgrade implies the claim (see the trigger in 20260809130000);
         -- stamping it here too keeps the RPC self-consistent when read on its own.
         claimed_at         = case when p_stage in ('claimed','upgraded') then coalesce(claimed_at, now()) else claimed_at end,
         upgraded_at        = case when p_stage = 'upgraded' then coalesce(upgraded_at, now()) else upgraded_at end,
         last_confirmed_at  = case when ended_at is null then now() else last_confirmed_at end
   where id = p_visit_id and user_id = v_user;

  v_advanced :=
       (p_stage in ('claimed','upgraded') and v_prev.claimed_at is null)
    or (p_stage = 'upgraded' and v_prev.upgraded_at is null)
    or (p_session_id is not null and v_prev.claimed_session_id is distinct from p_session_id);

  if v_advanced then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (p_visit_id, v_user, p_stage, jsonb_build_object('session_id', p_session_id));
  end if;
end;
$function$;
