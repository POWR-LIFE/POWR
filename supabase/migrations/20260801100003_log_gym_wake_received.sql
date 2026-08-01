-- wake_received: the missing device-side marker for the silent-wake path.
--
-- THE MEASUREMENT GAP THAT HID A DEAD iOS WAKE PATH FOR 17 DAYS AND 175 PUSHES.
-- Until now the only evidence a wake reached the device was `confirmed_inside` /
-- `confirmed_outside` — written by confirm_gym_visit_v2, i.e. INSIDE the call being
-- observed, and only after runVisitCheck has already taken a GPS fix. So these two
-- states were indistinguishable:
--     (a) the JS task never ran (dead binding, undelivered push, envelope bug)
--     (b) the JS task ran fine and the round-trip failed (no fix, offline, RPC error)
-- Both look like silence. The 2026-07-30 audit had to reason from Swift source in
-- node_modules to tell them apart.
--
-- Worse, the marker people reached for instead — `detail->>'via' = 'relay'` — is not
-- a wake marker at all: claim-points stamps it on ANY call carrying an
-- x-resolve-token, which the ordinary client dwell machine (relay_gym_claim) also
-- does. iOS `via:relay` rows exist on 8 distinct days back to 2026-07-15 while zero
-- wakes were being answered. Reading it as proof of a working wake path is exactly
-- the mistake this row exists to prevent.
--
-- This logs the moment the payload clears the type guard, BEFORE any GPS work — so
-- "the push woke us" and "the answer landed" become separately observable.
--
-- DELIBERATELY NOT guarded on `ended_at is null` (unlike log_gym_visit_tick): a wake
-- arriving for an already-closed visit is precisely the D2 stale-visitId symptom we
-- need to see. Proven 2026-07-16: four nudges for live visit 793e434a were answered
-- 0.6-0.9 s later by confirms written to the DEAD visit 2fa4e05d.
--
-- Never throws. The wake path has ~10 s of execution window mid-Doze and one
-- guaranteed round-trip; instrumentation must not spend the budget or break the
-- claim if it fails.

create or replace function public.log_gym_wake_received(
  p_visit_id uuid,
  p_stage    text,
  p_detail   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_user uuid := auth.uid();
begin
  -- A wake can land mid-auth-refresh. Silence beats an exception here.
  if v_user is null then return; end if;

  -- gym_visit_events.visit_id is NOT NULL and FK-constrained, so an unknown or
  -- unowned id cannot be logged at all — return rather than raise. The id always
  -- comes from the server's own push payload, so this should never fire.
  if not exists (
    select 1 from gym_visits where id = p_visit_id and user_id = v_user
  ) then
    return;
  end if;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (
    p_visit_id,
    v_user,
    'wake_received',
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('stage', p_stage)
  );
end;
$function$;

-- Called by the device as the signed-in user, immediately after the type guard.
revoke all on function public.log_gym_wake_received(uuid, text, jsonb) from public;
revoke all on function public.log_gym_wake_received(uuid, text, jsonb) from anon;
grant execute on function public.log_gym_wake_received(uuid, text, jsonb) to authenticated;
