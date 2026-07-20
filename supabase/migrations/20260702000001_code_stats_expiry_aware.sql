-- =============================================================
-- Expiry-aware code stats.
--
-- claim_pool_code only hands out codes with expires_at > now(), but
-- get_code_stats bucketed purely by status — so once a batch passed its
-- shelf-life the admin/partner UIs still showed hundreds "available"
-- while app users got OUT_OF_STOCK. Count date-lapsed available codes
-- as expired so the dashboards match what users can actually claim.
-- =============================================================
create or replace function public.get_code_stats(p_reward_id uuid)
returns table(status text, cnt bigint)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Access denied: admin only';
  end if;
  return query
    select case
             when rc.status = 'available' and rc.expires_at <= now() then 'expired'
             else rc.status
           end as status,
           count(*)::bigint as cnt
      from public.redemption_codes rc
     where rc.reward_id = p_reward_id
     group by 1;
end;
$$;
