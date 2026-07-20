-- ── Vault admin stats, aggregated server-side ───────────────────────────────
--
-- THE BUG THIS FIXES. VaultManager built its two stat cards by selecting every
-- row of vault_deposits and reducing them in the browser:
--
--   supabase.from('vault_deposits').select('user_id, amount, vests_at, released_at')
--
-- PostgREST caps an unbounded select at 1000 rows. Under that ceiling the cards
-- are right; the moment the table crosses it they start under-reporting with no
-- error, no warning, and no visible difference — the admin simply reads a
-- smaller number and believes it. A stats panel that silently lies as it grows
-- is worse than one that fails, so the aggregation moves into the database
-- where there is no row cap.
--
-- Also reports the rollout split, which the client-side version could not: how
-- much of the vesting POWR belongs to users who cannot yet SEE their Vault.
-- That figure is the size of the launch-day handover, and it is the one number
-- an admin staging a rollout actually wants before flipping the switch.

create or replace function public.admin_vault_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_out   jsonb;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  select jsonb_build_object(
    'vesting_points', coalesce(sum(amount), 0),
    'vesting_users',  count(distinct user_id),
    'ready_points',   coalesce(sum(amount) filter (where vests_at <= now()), 0),
    'ready_users',    count(distinct user_id) filter (where vests_at <= now()),
    -- The staged-rollout view: POWR banked for people who cannot see it yet.
    'hidden_points',  coalesce(sum(amount) filter (where not public.vault_has_access(user_id)), 0),
    'hidden_users',   count(distinct user_id) filter (where not public.vault_has_access(user_id))
  )
  into v_out
  from vault_deposits
  where released_at is null;

  return v_out;
end;
$$;

revoke all on function public.admin_vault_stats() from public, anon;
grant execute on function public.admin_vault_stats() to authenticated;

comment on function public.admin_vault_stats() is
  'Vault economy totals for the admin panel, aggregated in-database so the numbers do not silently cap at PostgREST''s 1000-row ceiling. Includes the rollout split (POWR banked for users who cannot yet see the Vault).';
