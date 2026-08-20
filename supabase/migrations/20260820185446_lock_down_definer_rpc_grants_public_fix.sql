-- Follow-up to 20260820185024: get_event_leaderboard reached anon via the
-- PUBLIC grant (=X/postgres), not an explicit anon grant, so revoking anon was
-- a no-op. Revoke PUBLIC; the explicit authenticated + service_role grants
-- stay, so app callers are unaffected.
revoke execute on function public.get_event_leaderboard(uuid, text) from public;
