-- Security-lint triage 2026-08-20. One real hole, the rest lint noise:
--
-- set_gym_visit_wake_nonce had EXECUTE for anon/authenticated with no internal
-- guard, letting anyone with the anon key plant their own nonce on any visit id
-- and then drive confirm_gym_visit_v3 (which impersonates the visit's owner once
-- the nonce matches) with p_request_credit=true. Only the gym-visit-beacon edge
-- function (service_role) legitimately mints nonces.
--
-- Everything else here changes no observable behavior: _gym_visit_nonce_ok is
-- only called from inside confirm_gym_visit_v3 (SECURITY DEFINER, runs as the
-- definer), guard_client_session_window is a trigger function, and
-- get_event_leaderboard already raises 42501 for anon callers.
--
-- Deliberately NOT revoked, despite the same lint firing on them:
--   *_by_ticket + revoke_device_wake_ticket  (ticket IS the credential; headless anon path)
--   confirm_gym_visit_v3 / log_gym_wake_received_v2  (nonce-gated wake path)
--   mark_push_displayed  (anon-key raw fetch on the wake path; log uuid is the capability)
--   mark_gym_visit_announced  (auth.uid()-scoped; anon call is a harmless no-op)
--   is_admin  (referenced from RLS policies, which evaluate as the calling role)

revoke execute on function public.set_gym_visit_wake_nonce(uuid, text, integer) from public, anon, authenticated;

revoke execute on function public._gym_visit_nonce_ok(uuid, text) from public, anon, authenticated;

revoke execute on function public.guard_client_session_window() from public, anon, authenticated;
revoke execute on function public.get_event_leaderboard(uuid, text) from anon;

alter function public.clear_gym_visit_wake_nonce() set search_path = public;
alter function public.normalize_member_id(text) set search_path = public;
