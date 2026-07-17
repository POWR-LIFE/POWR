-- DEV-ONLY: re-arm the vault unlock so the press-and-hold moment can be
-- tested repeatedly on a dev account.
--
-- Reverses the caller's released deposits back to ready (vests_at just
-- past) and DELETES their vault_release payout rows, so repeated test
-- unlocks don't inflate the balance. If the vault ends up with nothing
-- ready, banks a fresh 25-pt test deposit — the button always yields a
-- READY vault. Hard-gated to the dev test account (same address as
-- claim-points' DEV_TEST_EMAILS default and useLevelUp's replay gate);
-- for everyone else it raises and touches nothing.

create or replace function public.dev_rearm_vault()
returns table (ready_points int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_tx    uuid[];
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is distinct from 'jamiemasonwright@gmail.com' then
    raise exception 'DEV_ONLY';
  end if;

  -- Same per-user lock as the claim path, so a re-arm can't interleave
  -- with an in-flight unlock.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select array_agg(distinct released_tx) into v_tx
    from vault_deposits
   where user_id = v_uid and released_tx is not null;

  update vault_deposits
     set released_at = null, released_tx = null, vests_at = now() - interval '1 minute'
   where user_id = v_uid and released_at is not null;

  if v_tx is not null then
    delete from point_transactions
     where id = any(v_tx) and user_id = v_uid and source = 'vault_release';
  end if;

  if not exists (
    select 1 from vault_deposits
     where user_id = v_uid and released_at is null and vests_at <= now()
  ) then
    insert into vault_deposits (user_id, amount, source, description, created_at, vests_at)
    values (v_uid, 25, 'cap_overflow', 'DEV re-arm test deposit',
            now() - interval '30 days', now() - interval '1 minute');
  end if;

  select coalesce(sum(amount), 0)::int into ready_points
    from vault_deposits
   where user_id = v_uid and released_at is null and vests_at <= now();
  return next;
end;
$$;

revoke all on function public.dev_rearm_vault() from public, anon;
grant execute on function public.dev_rearm_vault() to authenticated;
