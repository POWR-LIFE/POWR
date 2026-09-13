-- relay_gym_claim: remember a refusal.
--
-- 2026-09-08, 15:27 → 18:37 UTC: claim-points answered 422 to 1,198 calls, one
-- every 10 s, all from pg_net for one phone. The client's session insert had hit
-- idx_one_session_per_type_per_day; its recovery picked "the latest gym session
-- started today", which was an Apple-Watch import (trust 0.85, no points); this
-- relay saw no earn rows on it and posted; the server refused (terminal); the
-- relay had already answered 'accepted', so the next 10-s tick did it again.
-- The beacon got the same lesson on 2026-09-05 (settle_declined). Two guards:
--   • a UTC day that already holds a PAID geofence gym session answers
--     'already_claimed_today' whatever row the client hands over — one gym
--     session per UTC day is the rule claim-points enforces anyway;
--   • a session that is not geofence-verified is 'not_relayable': nothing is
--     posted, the client logs it and moves on.
-- The client-side fix (recovery filters verification=geofence) ships with the
-- next OTA; this closes the loop for every build already in the field.
create or replace function public.relay_gym_claim(p_session_id uuid, p_visit_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user         uuid := auth.uid();
  v_req          bigint;
  v_started      timestamptz;
  v_verification text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select started_at, verification::text
    into v_started, v_verification
    from activity_sessions
   where id = p_session_id and user_id = v_user;
  if v_started is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Points already exist → nothing to relay; a retrying client resolves instantly.
  if exists (
    select 1 from point_transactions where session_id = p_session_id and type = 'earn'
  ) then
    return jsonb_build_object('status', 'already_claimed');
  end if;

  -- The day is already paid for a geofence gym session → nothing to relay,
  -- whichever row this is. A DISTINCT status: 'already_claimed' makes the client
  -- stamp p_session_id onto the visit (mark_gym_visit_progress lets the caller's
  -- id win), and here p_session_id may be the wrong row. Do not post; do not loop.
  if exists (
    select 1
      from activity_sessions a
      join point_transactions pt on pt.session_id = a.id and pt.type = 'earn'
     where a.user_id = v_user
       and a.type = 'gym'
       and a.verification = 'geofence'
       and date_trunc('day', a.started_at at time zone 'UTC')
         = date_trunc('day', v_started at time zone 'UTC')
  ) then
    return jsonb_build_object('status', 'already_claimed_today');
  end if;

  -- Only a geofence-verified session is a gym claim. Anything else is the
  -- 2026-09-08 shape and must not reach claim-points.
  if v_verification is distinct from 'geofence'
     or not exists (
       select 1
         from activity_sessions
        where id = p_session_id
          and type = 'gym'
     ) then
    return jsonb_build_object('status', 'not_relayable', 'verification', v_verification);
  end if;

  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/claim-points',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object(
      'session_id', p_session_id,
      'user_id', v_user,
      'visit_id', p_visit_id
    )
  ) into v_req;

  return jsonb_build_object('status', 'accepted', 'request_id', v_req);
end;
$function$;
