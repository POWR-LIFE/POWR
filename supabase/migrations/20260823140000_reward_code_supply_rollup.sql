-- =============================================================
-- get_reward_code_supply — claimable pool depth for every reward, in one hop.
--
-- The admin Vault listed every reward with stock IS NULL as "Unlimited
-- Supply", but stock is decorative: redeem-reward never reads it. What
-- actually caps a POOL reward is its promo-code pool, and claim_pool_code
-- only serves rows with status='available' AND expires_at > now(). So a
-- reward with 1,000 loaded codes — or 1,000 codes that all lapsed last
-- week — both read as "unlimited" while members hit OUT_OF_STOCK.
--
-- Mirrors get_code_stats' bucketing (date-lapsed available => expired) but
-- rolls up across all rewards so the listing needs one call, not one per
-- reward — and no PostgREST row cap in between.
-- =============================================================
create or replace function public.get_reward_code_supply()
returns table(
  reward_id uuid,
  claimable bigint,
  lapsed    bigint,
  reserved  bigint,
  used      bigint,
  soonest_expiry timestamptz
)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Access denied: admin only';
  end if;
  return query
    select rc.reward_id,
           count(*) filter (where rc.status = 'available' and rc.expires_at > now())::bigint,
           count(*) filter (where rc.status = 'available' and (rc.expires_at is null or rc.expires_at <= now()))::bigint,
           count(*) filter (where rc.status = 'reserved')::bigint,
           count(*) filter (where rc.status = 'used')::bigint,
           min(rc.expires_at) filter (where rc.status = 'available' and rc.expires_at > now())
      from public.redemption_codes rc
     group by rc.reward_id;
end;
$$;

revoke all on function public.get_reward_code_supply() from public, anon;
grant execute on function public.get_reward_code_supply() to authenticated;
