-- 2026-09-06 · Scaling plan Phase 2, item 7 — RLS shape on the hot tables.
--
-- Two things, same access outcome for every legitimate caller:
--
--  (a) The eight hot tables each carried two or three PERMISSIVE policies for the
--      same (role, action) — "own rows" beside "admins see all" — so Postgres
--      evaluated every one of them per row (advisor: multiple_permissive_policies,
--      237 warnings). Each pair is now ONE policy joined with OR.
--
--  (b) Every remaining public policy that called auth.uid() / auth.role() bare
--      re-evaluated it per row (advisor: auth_rls_initplan, 134 warnings). They are
--      rewritten as (select auth.<fn>()) so the planner evaluates the call once per
--      statement. The rewrite is textual over pg_get_expr output and touches nothing
--      else about a policy (roles, command, permissiveness stay as they were).
--
-- ⚠ ONE DELIBERATE CHANGE IN OUTCOME — profiles UPDATE. Three permissive policies
-- meant a row passed if ANY of them did, and "Users can update their own profile"
-- (WITH CHECK auth.uid() = id) let a member write is_pro / is_admin on their own
-- row; tr_sync_admin_role then copied is_admin = true into admin_roles, which is
-- what is_admin() reads. The merged policy keeps the pin from "Users can update own
-- extended profile fields" (those two columns must be re-written unchanged unless
-- the caller is an admin), so that path is closed. admin_roles held exactly the
-- three intended admins at the time of writing.
--
-- is_admin() is SECURITY DEFINER over admin_roles and depends only on the caller's
-- JWT, so (select public.is_admin()) is an initplan too — one call per statement.

-- ── activity_sessions ──────────────────────────────────────────────────────
drop policy if exists "Admins can read all activity sessions" on public.activity_sessions;
drop policy if exists "Users can read their own sessions"     on public.activity_sessions;
create policy activity_sessions_select on public.activity_sessions
  for select to public
  using (((select auth.uid()) = user_id) or (select public.is_admin()));

-- ── geofence_region_events ─────────────────────────────────────────────────
drop policy if exists geofence_region_events_select_admin on public.geofence_region_events;
drop policy if exists geofence_region_events_select_own   on public.geofence_region_events;
create policy geofence_region_events_select on public.geofence_region_events
  for select to public
  using ((user_id = (select auth.uid())) or (select public.is_admin()));

-- ── gym_visit_events ───────────────────────────────────────────────────────
drop policy if exists "Admins read all gym visit events" on public.gym_visit_events;
drop policy if exists "Users read own gym visit events"  on public.gym_visit_events;
create policy gym_visit_events_select on public.gym_visit_events
  for select to public
  using ((user_id = (select auth.uid())) or (select public.is_admin()));

-- ── gym_visits ─────────────────────────────────────────────────────────────
drop policy if exists "Admins read all gym visits" on public.gym_visits;
drop policy if exists "Users read own gym visits"  on public.gym_visits;
create policy gym_visits_select on public.gym_visits
  for select to public
  using ((user_id = (select auth.uid())) or (select public.is_admin()));

-- ── partners ───────────────────────────────────────────────────────────────
-- "Admins can manage partners" was FOR ALL, which also counted as a second SELECT
-- policy beside the public one. Split by verb: one SELECT, admin-only writes.
drop policy if exists "Admins can manage partners"     on public.partners;
drop policy if exists "Partners are publicly readable" on public.partners;
create policy partners_select on public.partners
  for select to public
  using ((active = true) or (select public.is_admin()));
create policy partners_admin_insert on public.partners
  for insert to public
  with check ((select public.is_admin()));
create policy partners_admin_update on public.partners
  for update to public
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy partners_admin_delete on public.partners
  for delete to public
  using ((select public.is_admin()));

-- ── point_transactions ─────────────────────────────────────────────────────
drop policy if exists "Admins can insert point transactions"   on public.point_transactions;
drop policy if exists "Users can insert their own transactions" on public.point_transactions;
create policy point_transactions_insert on public.point_transactions
  for insert to public
  with check (((select auth.uid()) = user_id) or (select public.is_admin()));
drop policy if exists "Admins can read all point transactions" on public.point_transactions;
drop policy if exists "Users can read their own transactions"  on public.point_transactions;
create policy point_transactions_select on public.point_transactions
  for select to public
  using (((select auth.uid()) = user_id) or (select public.is_admin()));

-- ── profiles ───────────────────────────────────────────────────────────────
-- "Profiles are publicly readable" (USING true) stays and becomes the only SELECT
-- policy; the two it shadowed added nothing.
drop policy if exists "Admins can view all profiles"     on public.profiles;
drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Admins can update is_pro"                     on public.profiles;
drop policy if exists "Users can update own extended profile fields" on public.profiles;
drop policy if exists "Users can update their own profile"           on public.profiles;
create policy profiles_update on public.profiles
  for update to public
  using (((select auth.uid()) = id) or (select public.is_admin()))
  with check (
    (select public.is_admin())
    or (
      ((select auth.uid()) = id)
      -- The two privilege columns must come back unchanged from a member's own write.
      -- `is not distinct from` so a NULL on either side cannot lock a member out.
      and is_pro   is not distinct from (select p.is_pro   from public.profiles p where p.id = (select auth.uid()))
      and is_admin is not distinct from (select p.is_admin from public.profiles p where p.id = (select auth.uid()))
    )
  );

-- ── user_push_tokens ───────────────────────────────────────────────────────
-- "users manage own push tokens" was FOR ALL; alongside two SELECT policies that
-- made three per SELECT. The service_role clause is kept verbatim inside the merged
-- SELECT so the outcome is identical (service_role bypasses RLS anyway).
drop policy if exists "users manage own push tokens"      on public.user_push_tokens;
drop policy if exists "Admins can read all push tokens"   on public.user_push_tokens;
drop policy if exists "service role read all push tokens" on public.user_push_tokens;
create policy user_push_tokens_select on public.user_push_tokens
  for select to public
  using (((select auth.uid()) = user_id) or (select public.is_admin()) or ((select auth.role()) = 'service_role'::text));
create policy user_push_tokens_insert on public.user_push_tokens
  for insert to public
  with check ((select auth.uid()) = user_id);
create policy user_push_tokens_update on public.user_push_tokens
  for update to public
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy user_push_tokens_delete on public.user_push_tokens
  for delete to public
  using ((select auth.uid()) = user_id);

-- ── (b) initplan rewrite for every other public policy ─────────────────────
-- Policies that already use the wrapped form deparse as "( SELECT auth.uid() AS uid)"
-- and are skipped; nothing in public mixed both forms at the time of writing.
-- storage.* policies are Supabase-managed and left alone.
do $$
declare
  r    record;
  q    text;
  wc   text;
  stmt text;
  n    int := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~  '\mauth\.(uid|role|jwt|email)\(\)'
      and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'SELECT auth\.(uid|role|jwt|email)\(\)'
    order by tablename, policyname
  loop
    q  := case when r.qual       is null then null
               else regexp_replace(r.qual,       '\mauth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g') end;
    wc := case when r.with_check is null then null
               else regexp_replace(r.with_check, '\mauth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g') end;
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if q  is not null then stmt := stmt || format(' using (%s)', q); end if;
    if wc is not null then stmt := stmt || format(' with check (%s)', wc); end if;
    execute stmt;
    n := n + 1;
  end loop;
  raise notice 'rls_initplan: rewrote % policies', n;
end $$;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  bare  int;
  multi int;
begin
  select count(*) into bare
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || coalesce(with_check, '')) ~  '\mauth\.(uid|role|jwt|email)\(\)'
    and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'SELECT auth\.(uid|role|jwt|email)\(\)';
  if bare <> 0 then
    raise exception 'rls_initplan: % public policies still call auth.*() bare', bare;
  end if;

  -- No hot table may have more than one permissive policy per plain command.
  select count(*) into multi
  from (
    select tablename, cmd
    from pg_policies
    where schemaname = 'public'
      and tablename in ('activity_sessions', 'geofence_region_events', 'gym_visit_events', 'gym_visits',
                        'partners', 'point_transactions', 'profiles', 'user_push_tokens', 'push_send_log')
      and permissive = 'PERMISSIVE'
    group by tablename, cmd
    having count(*) > 1 or bool_or(cmd = 'ALL')
  ) s;
  if multi <> 0 then
    raise exception 'rls_initplan: % hot-table (table, cmd) pairs still stack permissive policies', multi;
  end if;
end $$;
