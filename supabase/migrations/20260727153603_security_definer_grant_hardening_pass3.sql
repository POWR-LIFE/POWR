-- Security lint hardening, pass 3 (2026-07-27)
--
-- Context: passes 1 (20260611000001) and 2 (20260709000002) left a deliberate
-- baseline of ~31 self-authorising definer-RPC WARNs. That baseline has since
-- grown to 87 as new functions landed without grant hygiene. This pass clears
-- the genuinely-dead grants and fixes three real authorisation gaps, while
-- leaving the intentional definer-RPC pattern untouched.
--
-- Gotcha re-proven every pass: revoking anon/authenticated does NOT clear the
-- lint or the access if PUBLIC still holds EXECUTE (the "=X/postgres" ACL
-- entry) — those roles inherit it. Every revoke below therefore names PUBLIC.

-- (No explicit BEGIN/COMMIT: migrations are already applied in a transaction.)

-- ---------------------------------------------------------------------------
-- 1. Trigger functions: dead API grants  (clears 12 WARNs, 6 anon + 6 auth)
-- ---------------------------------------------------------------------------
-- All six RETURN trigger and are attached to exactly one trigger. They cannot
-- be invoked over the API at all: plpgsql rejects them at compile time
-- ("trigger functions can only be called as triggers") and PostgREST excludes
-- trigger-returning functions from its schema cache (404 PGRST202). The grant
-- is pure residue. EXECUTE on a trigger function is only checked at CREATE
-- TRIGGER time, never at fire time, so revoking cannot stop the triggers.
--
-- This restores the convention already applied to the other ten trigger
-- functions (handle_new_user, notify_new_user_signup, vault_level_up_check,
-- enforce_point_award_cap, ...), all of which sit at {postgres=X,service_role=X}.
--
-- Worth clearing rather than ignoring: four of these read
-- vault.decrypted_secrets and fire net.http_post.

revoke execute on function public.notify_level_up_email()   from public, anon, authenticated;
revoke execute on function public.notify_level_up_push()    from public, anon, authenticated;
revoke execute on function public.notify_reward_unlocks()   from public, anon, authenticated;
revoke execute on function public.streak_rescue_progress()  from public, anon, authenticated;
revoke execute on function public.sync_partner_locations()  from public, anon, authenticated;
revoke execute on function public.tg_code_used_webhook()    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Anon EXECUTE on user-scoped RPCs  (clears the remaining 0028 anon WARNs)
-- ---------------------------------------------------------------------------
-- Each of these already rejects a NULL auth.uid() on its first statement, so
-- anon is functionally blocked today. This is defence-in-depth: it removes the
-- reliance on that internal check and takes the endpoints off the anon surface.
-- `authenticated` and `service_role` hold their own explicit grants and are
-- unaffected. Verified: no RLS policy references any of these functions.

-- These carry an explicit anon=X entry and no PUBLIC grant.
revoke execute on function public.open_gym_visit(uuid, text, timestamptz, text)  from anon;
revoke execute on function public.close_gym_visit(uuid, timestamptz)             from anon;
revoke execute on function public.confirm_gym_visit(uuid, boolean, jsonb)        from anon;
revoke execute on function public.log_gym_visit_tick(uuid, jsonb)                from anon;
revoke execute on function public.mark_gym_visit_progress(uuid, text, uuid)      from anon;

-- These reach anon only via the PUBLIC "=X" grant; authenticated keeps its own.
revoke execute on function public.claim_device(text, text)                       from public;
revoke execute on function public.confirm_device_transfer(text, text)            from public;
revoke execute on function public.admin_get_user_devices(uuid)                   from public;
revoke execute on function public.admin_get_user_device_transfers(uuid, integer) from public;
revoke execute on function public.admin_release_device(text)                     from public;
revoke execute on function public.admin_release_user_devices(uuid)               from public;

-- ---------------------------------------------------------------------------
-- 3a. close_gym_visit — ownership scope was applied to the UPDATE only
-- ---------------------------------------------------------------------------
-- The UPDATE is correctly scoped (`user_id = v_user`) but the follow-up INSERT
-- into gym_visit_events used the caller-supplied p_visit_id unconditionally,
-- with no `if not found` guard. An authenticated caller could therefore write a
-- forged 'exit' event against any visit id they know — including another
-- user's — and the RPC returned success. Those rows surface in the victim's
-- timeline on the admin UserProfile page (landing-page/src/pages/admin/
-- UserProfile.jsx:647), which renders event/detail without user_id.
--
-- Fixed with an ownership predicate on the INSERT rather than `if not found`,
-- so a repeat close of the caller's OWN (already-closed) visit still logs, and
-- existing telemetry behaviour is preserved. Only the cross-user write changes.

create or replace function public.close_gym_visit(
  p_visit_id uuid,
  p_ended_at timestamp with time zone default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  update gym_visits
     set ended_at = coalesce(p_ended_at, now()),
         status   = 'closed'
   where id = p_visit_id and user_id = v_user and ended_at is null;

  -- Ownership guard: never log an event against a visit the caller does not own.
  insert into gym_visit_events (visit_id, user_id, event, detail)
  select p_visit_id, v_user, 'exit',
         jsonb_build_object('ended_at', coalesce(p_ended_at, now()))
   where exists (
     select 1 from gym_visits
      where id = p_visit_id and user_id = v_user
   );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3b. vault_has_access — cross-user oracle, no authorisation at all
-- ---------------------------------------------------------------------------
-- The function answers a question ABOUT an arbitrary p_user and performed no
-- authorisation whatsoever. Confirmed live: a non-admin, non-cohort caller got
-- `true` for Vault cohort members and `false` for themselves. Today that leaks
-- membership of a 4-person beta cohort; with a levels or activities rule
-- configured (both supported by admin_set_vault_rollout and exposed in
-- VaultManager.jsx) the same call becomes an oracle for any user's level or
-- activity preferences, iterable over enumerable uuids.
--
-- Deliberately fixed with an internal gate, NOT a revoke: revoking
-- `authenticated` would break landing-page/src/pages/admin/UserProfile.jsx:298.
-- The `auth.uid() is not null` term is load-bearing — five internal callers
-- (get_my_vault_access, admin_vault_stats, notify_matured_vault_deposits,
-- process_vault_unlock_events, admin_set_vault_launch, plus the service_role
-- edge fn supabase/functions/send-push-notification/index.ts:742) run with no
-- JWT, and anon holds no EXECUTE here, so the JWT-less path stays open.
--
-- The two `fail open` branches are left exactly as-is on purpose: they are the
-- hardening added after the 2026-07-20 vault_rollout JSON outage.

create or replace function public.vault_has_access(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cfg    jsonb;
  v_mode   text;
  v_launch text;
begin
  if p_user is null then
    return false;
  end if;

  -- A signed-in caller may only ask about themselves, unless they are an admin.
  -- Internal callers (cron, service_role, other definer functions) have no JWT
  -- and are intentionally exempt; anon holds no EXECUTE on this function.
  if auth.uid() is not null
     and p_user <> auth.uid()
     and not exists (select 1 from admin_roles where user_id = auth.uid())
  then
    raise exception 'NOT_AUTHORIZED';
  end if;

  begin
    select value::jsonb into v_cfg from system_config where key = 'vault_rollout';
  exception when others then
    return true; -- malformed JSON: fail open
  end;

  if v_cfg is null then
    return true; -- row missing entirely: fail open
  end if;

  v_mode := coalesce(v_cfg->>'mode', 'all');
  if v_mode = 'all'  then return true;  end if;
  if v_mode = 'none' then return false; end if;

  -- Scheduled launch: once vault_launch_at passes, 'targeted' opens to
  -- everyone. Checked after 'none' (the kill switch wins) and before the
  -- cohort rules (a passed launch admits people no rule matches).
  begin
    select nullif(trim(value), '') into v_launch
      from system_config where key = 'vault_launch_at';
    if v_launch is not null and v_launch::timestamptz <= now() then
      return true;
    end if;
  exception when others then
    null; -- unparseable date: no launch rule; the cohort rules below still apply
  end;

  -- targeted: any rule matching is enough.
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(v_cfg->'user_ids', '[]'::jsonb)) x
     where x = p_user::text
  ) then
    return true;
  end if;

  -- Only pay for the level maths when a levels rule actually exists — this
  -- function runs on app load, and vault_user_level sums two tables.
  if jsonb_array_length(coalesce(v_cfg->'levels', '[]'::jsonb)) > 0 then
    if exists (
      select 1 from jsonb_array_elements_text(v_cfg->'levels') lv
       -- Digits only, BEFORE the cast: a junk entry is a rule that matches
       -- nobody, not an exception that seals the vault and kills the sweep.
       where lv ~ '^\d+$'
         and lv::int = public.vault_user_level(p_user)
    ) then
      return true;
    end if;
  end if;

  if jsonb_array_length(coalesce(v_cfg->'activities', '[]'::jsonb)) > 0 then
    if exists (
      select 1 from profiles p
       where p.id = p_user
         and p.activity_preferences::text[] && (
           select array_agg(a) from jsonb_array_elements_text(v_cfg->'activities') a
         )
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3c. get_taken_grid_cells — non-admin branch gated on a global flag only
-- ---------------------------------------------------------------------------
-- The non-admin authorisation branch was `public.partner_placements_enabled()`
-- — a global system_config feature flag with no check that the caller is a
-- brand user at all. Once that flag is flipped on, every authenticated
-- principal (including an ordinary consumer app user) could enumerate the
-- worldwide occupied-cell map of every brand's active paid placements by
-- passing an unbounded bounding box.
--
-- Not currently exploitable: the flag reads 'false' in production today, so a
-- non-admin caller gets zero rows. This closes it before self-serve placements
-- are switched on.
--
-- Not a revoke: this RPC is the sole data source for PlacementGridMap.jsx:131,
-- shared by the partner and admin pages. Reading past the
-- reward_placement_cells RLS policy is the point (the booking picker must show
-- competitors' taken cells); it just needs to re-impose brand membership.

create or replace function public.get_taken_grid_cells(
  p_south double precision,
  p_west double precision,
  p_north double precision,
  p_east double precision,
  p_exclude uuid,
  p_starts timestamp with time zone,
  p_ends timestamp with time zone,
  p_mask text
)
returns table(z smallint, x integer, y integer)
language sql
stable
security definer
set search_path to ''
as $function$
  with occupied_cells as (
    select rc.z, rc.x, rc.y, rc.placement_id,
      (rc.x::float / (1 << rc.z::int) * 360 - 180) as west,
      ((rc.x + 1)::float / (1 << rc.z::int) * 360 - 180) as east,
      degrees(atan(sinh(pi() * (1 - 2 * rc.y::float / (1 << rc.z::int))))) as north,
      degrees(atan(sinh(pi() * (1 - 2 * (rc.y + 1)::float / (1 << rc.z::int))))) as south
    from public.reward_placement_cells rc
  )
  select occupied_cells.z, occupied_cells.x, occupied_cells.y
  from occupied_cells
  join public.reward_placements other_placement on other_placement.id = occupied_cells.placement_id
  where (
      exists (select 1 from public.admin_roles where user_id = auth.uid())
      or (
        public.partner_placements_enabled()
        and exists (select 1 from public.reward_brand_users where user_id = auth.uid())
      )
    )
    and other_placement.active = true
    and occupied_cells.placement_id is distinct from p_exclude
    and occupied_cells.west <= p_east and occupied_cells.east >= p_west
    and occupied_cells.south <= p_north and occupied_cells.north >= p_south
    and tstzrange(coalesce(p_starts, '-infinity'), coalesce(p_ends, 'infinity'), '[]')
        && tstzrange(coalesce(other_placement.starts_at, '-infinity'), coalesce(other_placement.ends_at, 'infinity'), '[]')
    and (
      coalesce(nullif(p_mask, '')::bit(168), (repeat('1', 168))::bit(168))
      & coalesce(other_placement.week_mask, (repeat('1', 168))::bit(168))
    ) <> (repeat('0', 168))::bit(168);
$function$;

-- ---------------------------------------------------------------------------
-- 4. Service-role-only tables: drop the redundant API grants
-- ---------------------------------------------------------------------------
-- These four are the rls_enabled_no_policy INFO items. RLS-on with no policy is
-- already the correct deny-all state and it is holding (probed: anon sees 0
-- rows). But each still carries a full table-level GRANT to anon/authenticated,
-- so RLS is the ONLY thing standing between anon and the contents — and
-- reward_brand_shopify holds a live Shopify access_token and refresh_token.
-- Removing the grant means an accidental `alter table ... disable row level
-- security` in a future migration is no longer a one-line credential leak.
-- service_role bypasses RLS and keeps its own grant, so nothing changes
-- functionally.

revoke all on table public.reward_brand_shopify         from anon, authenticated;
revoke all on table public.reward_brand_api_idempotency from anon, authenticated;
revoke all on table public.reward_brand_api_rate        from anon, authenticated;
revoke all on table public.level_up_email_log           from anon, authenticated;
