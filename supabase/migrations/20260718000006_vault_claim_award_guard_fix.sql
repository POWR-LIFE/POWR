-- claim_my_vault_deposits vs the anti-cheat guard.
--
-- enforce_point_award_cap (BEFORE INSERT on point_transactions) rejects any
-- non-session row from an *authenticated* request context, and it keys off
-- the REQUEST JWT — SECURITY DEFINER doesn't change that. So the manual
-- vault unlock's 'bonus' credit was rejected and the claim rolled back
-- (observed 2026-07-17, first press-and-hold E2E).
--
-- Same fix as process_referral (20260617000003): elevate to the
-- service-role context for just this one trusted, guarded insert, then
-- restore. The amount is the sum of the caller's OWN matured deposits under
-- a per-user advisory lock — nothing here is client-controlled.

create or replace function public.claim_my_vault_deposits()
returns table (points int, deposits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_ids    uuid[];
  v_pts    int;
  v_cnt    int;
  v_tx     uuid;
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Same per-user lock as spend_points: serialises against concurrent
  -- claims, spends, and the cron sweep.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select array_agg(id), coalesce(sum(amount), 0)::int, count(*)::int
    into v_ids, v_pts, v_cnt
    from vault_deposits
   where user_id = v_uid and released_at is null and vests_at <= now();

  if v_cnt = 0 or v_pts <= 0 then
    points := 0; deposits := 0;
    return next;
    return;
  end if;

  -- Trusted award: elevate so enforce_point_award_cap passes this
  -- non-session bonus row through, exactly as it does for the cron sweep
  -- (which runs as service role).
  perform set_config(
    'request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text,
    true
  );

  insert into point_transactions (user_id, amount, type, source, description, multiplier)
  values (v_uid, v_pts, 'bonus', 'vault_release', 'Vault unlocked', 1.0)
  returning id into v_tx;

  -- Restore the original request context.
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  update vault_deposits
     set released_at = now(), released_tx = v_tx
   where id = any(v_ids);

  points := v_pts; deposits := v_cnt;
  return next;
end;
$$;

revoke all on function public.claim_my_vault_deposits() from public, anon;
grant execute on function public.claim_my_vault_deposits() to authenticated;
