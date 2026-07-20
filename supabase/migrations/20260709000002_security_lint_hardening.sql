-- Security-linter hardening (Supabase advisor WARNs), chosen to have ZERO user impact.
--
-- Scope decision: we only touch items that are provably safe. We deliberately do NOT
-- revoke the many `authenticated`-executable SECURITY DEFINER RPCs (get_profile_social,
-- get_my_shared_challenges, resolve_reward_placements, admin_*, etc.) — those are the
-- core definer-RPC pattern the app relies on to read owner-locked tables past RLS, and
-- revoking them would break live features. We also leave public.is_admin() callable by
-- anon/authenticated because 17+ RLS policies invoke it during policy evaluation.

-- 1) function_search_path_mutable: is_device_lock_exempt
--    Pure IMMUTABLE function over literal strings; pinning search_path is behaviour-neutral.
ALTER FUNCTION public.is_device_lock_exempt(text) SET search_path = '';

-- 2) 0028/0029: three internal SECURITY DEFINER functions that no client role should call.
--    - enforce_single_owner_push_token: a TRIGGER function (triggers don't use EXECUTE grants).
--    - broadcast_zone_count / due_broadcast_dispatches: called ONLY by the
--      dispatch-scheduled-broadcasts edge function via the service_role admin client.
--    service_role and postgres retain their explicit grants, so every real caller keeps
--    working. We revoke from PUBLIC (as well as anon/authenticated) because these functions
--    granted EXECUTE to PUBLIC, which anon/authenticated inherit — revoking only the named
--    roles would leave the PUBLIC grant (and the linter WARN) in place.
REVOKE EXECUTE ON FUNCTION public.enforce_single_owner_push_token() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broadcast_zone_count()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.due_broadcast_dispatches()      FROM PUBLIC, anon, authenticated;

-- 3) extension_in_public: btree_gist.
--    Verified no index/constraint in the DB uses a btree_gist opclass (the one exclusion
--    constraint, featured_no_overlap, uses the built-in pg_catalog.range_ops). Moving it to
--    the standard Supabase `extensions` schema is therefore a no-rebuild, reversible change.
ALTER EXTENSION btree_gist SET SCHEMA extensions;
